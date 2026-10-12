import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import * as BaseSchemas from "./baseSchemas.ts";
import {
  ForwardCompatibleArray,
  ForwardCompatibleUnion,
  ForwardCompatibleUnionArray,
  filterDecodedArray,
  isUnknownUnionMember,
  TrimmedNonEmptyString,
  UnknownUnionMember,
} from "./baseSchemas.ts";

const at = "2026-10-05T00:00:00.000Z";
const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("circle"), radius: Schema.Number, at: Schema.DateTimeUtc }),
  Schema.Struct({ kind: Schema.Literal("square"), side: Schema.Number }),
]);
const members = Shape.members;
/** How clients decode: the JSON wire codec over the runtime schema. */
const fromWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];

describe("ForwardCompatibleArray", () => {
  it("decodes elements through their own codec and drops ones it cannot read", () => {
    const decoded = fromWire(ForwardCompatibleArray(Shape))([
      { kind: "circle", radius: 1, at },
      { kind: "triangle" },
      { kind: "square", side: "wide" },
    ]);
    expect(decoded).toHaveLength(1);
    expect(DateTime.isDateTime((decoded[0] as { at: unknown }).at)).toBe(true);
  });

  it("applies decoding defaults instead of failing", () => {
    const WithDefault = Schema.Struct({
      name: Schema.String,
      count: Schema.optionalKey(Schema.Number).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(7)),
      ),
    });
    expect(Schema.decodeUnknownSync(ForwardCompatibleArray(WithDefault))([{ name: "a" }])).toEqual([
      { name: "a", count: 7 },
    ]);
  });

  const Named = ForwardCompatibleArray(Schema.Struct({ name: TrimmedNonEmptyString }));

  it("drops an element it cannot encode instead of failing the array", () => {
    const wire = JSON.parse(
      JSON.stringify(
        Schema.encodeUnknownSync(Schema.toCodecJson(Named))([
          { name: "a" },
          { name: " " },
          { name: "b" },
        ]),
      ),
    );
    expect(wire).toEqual([{ name: "a" }, { name: "b" }]);
    expect(fromWire(Named)(wire)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("drops it too when a wrapper reads the encoded array as JSON values", () => {
    // How context records are bounded before forward-compatible decoding.
    const Wrapped = Schema.Array(Schema.Unknown).pipe(Schema.decodeTo(Named));
    expect(
      Schema.encodeUnknownSync(Schema.toCodecJson(Wrapped))([{ name: "a" }, { name: " " }]),
    ).toEqual([{ name: "a" }]);
  });

  it("still drops the null holes a server on an earlier build sends", () => {
    expect(fromWire(Named)([{ name: "a" }, null, { name: "b" }])).toEqual([
      { name: "a" },
      { name: "b" },
    ]);
  });

  it("does not accept holes as a decoded value", () => {
    expect(Schema.is(Named)([undefined])).toBe(false);
    // A sparse array's missing index is a hole too.
    const sparse: Array<{ name: string }> = [{ name: "a" }];
    sparse.length = 2;
    expect(Schema.is(Named)(sparse)).toBe(false);
    expect(() => Named.make(sparse)).toThrow();
    expect(Schema.is(Named)([{ name: "a" }])).toBe(true);
  });
});

describe("ForwardCompatibleUnion", () => {
  const decode = fromWire(ForwardCompatibleUnion(members, "kind"));

  it("decodes a member from a newer server as unknown", () => {
    const decoded = decode({ kind: "triangle", corners: 3 });
    expect(isUnknownUnionMember(decoded)).toBe(true);
    expect(decoded).toEqual(new UnknownUnionMember("kind", "triangle"));
  });

  it("decodes known members in full, transformations included", () => {
    const decoded = decode({ kind: "circle", radius: 1, at });
    expect(isUnknownUnionMember(decoded)).toBe(false);
    expect(DateTime.isDateTime((decoded as { at: unknown }).at)).toBe(true);
  });

  it("still fails a known member whose payload is broken", () => {
    expect(() => decode({ kind: "square", side: "wide" })).toThrow();
  });

  it("refuses to encode an unknown member", () => {
    const encode = Schema.encodeSync(ForwardCompatibleUnion(members, "kind") as never);
    expect(() => encode(new UnknownUnionMember("kind", "triangle") as never)).toThrow();
  });
});

describe("ForwardCompatibleUnionArray", () => {
  it("validates each known member once when decoding typed and JSON arrays", () => {
    let checks = 0;
    const Counted = Schema.Struct({
      kind: Schema.Literal("counted"),
      count: Schema.Number.check(
        Schema.makeFilter(() => {
          checks++;
          return true;
        }),
      ),
    });
    const array = ForwardCompatibleUnionArray([Counted], "kind");
    const input = [{ kind: "future" }, { kind: "counted", count: 1 }];
    for (const codec of [array, Schema.toCodecJson(array)]) {
      checks = 0;
      expect(Schema.decodeUnknownSync(codec)(input)).toEqual([{ kind: "counted", count: 1 }]);
      expect(checks).toBe(1);
    }
  });

  it("keeps a known member however its fields are named", () => {
    const Flagged = Schema.Struct({
      kind: Schema.Literal("flag"),
      _unknown: Schema.Literal(true),
      tag: Schema.String,
      value: Schema.String,
    });
    const flag = { kind: "flag", _unknown: true, tag: "kind", value: "x" };
    expect(fromWire(ForwardCompatibleUnionArray([Flagged], "kind"))([flag])).toEqual([flag]);
  });

  const decode = fromWire(ForwardCompatibleUnionArray(members, "kind"));

  it("drops members a newer server added and keeps the rest", () => {
    const decoded = decode([
      { kind: "triangle" },
      { kind: "circle", radius: 1, at },
      { kind: "square", side: 2 },
    ]);
    expect(decoded.map((shape) => shape.kind)).toEqual(["circle", "square"]);
  });

  it("fails when a known member is broken, so real bugs stay visible", () => {
    expect(() => decode([{ kind: "square", side: "wide" }])).toThrow();
  });

  it("encodes as a plain array", () => {
    const encode = Schema.encodeSync(
      Schema.toCodecJson(ForwardCompatibleUnionArray(members, "kind")),
    );
    const square = { kind: "square" as const, side: 2 };
    expect(encode([square])).toEqual([square]);
  });

  it("preserves transformations, defaults, validation and both encodings", () => {
    const WithDefault = Schema.Struct({
      kind: Schema.Literal("dated"),
      at: Schema.DateTimeUtc,
      name: TrimmedNonEmptyString,
      count: Schema.optionalKey(Schema.Number).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(7)),
      ),
    });
    const array = ForwardCompatibleUnionArray([WithDefault], "kind");
    const plain = Schema.Array(WithDefault);
    const typedInput = [{ kind: "dated", at: DateTime.makeUnsafe(at), name: "  a  " }];
    const jsonInput = [{ ...typedInput[0], at }];
    for (const [codec, ordinary, input] of [
      [array, plain, typedInput],
      [Schema.toCodecJson(array), Schema.toCodecJson(plain), jsonInput],
    ] as const) {
      const decoded = Schema.decodeUnknownSync(codec)([{ kind: "future" }, ...input]);
      expect(decoded).toEqual(Schema.decodeUnknownSync(ordinary)(input));
      expect(decoded[0]).toEqual({
        kind: "dated",
        at: DateTime.makeUnsafe(at),
        name: "a",
        count: 7,
      });
      expect(Schema.encodeSync(codec)(decoded)).toEqual(Schema.encodeSync(ordinary)(decoded));
      expect(Schema.is(codec)(decoded)).toBe(true);
      expect(codec.make(decoded)).toEqual(decoded);
      const sparse = [...decoded];
      sparse.length++;
      for (const invalid of [
        [{ kind: "future" }],
        [new UnknownUnionMember("kind", "future")],
        [{ ...decoded[0], count: "bad" }],
        [{ ...decoded[0], at }],
        [undefined],
        sparse,
      ]) {
        expect(Schema.is(codec)(invalid)).toBe(Schema.is(ordinary)(invalid));
        expect(() => codec.make(invalid as never)).toThrow();
        expect(() => Schema.encodeUnknownSync(codec)(invalid)).toThrow();
      }
    }
    const typed = Schema.toType(array);
    // Composing another source must still validate the declared target.
    const wrapped = Schema.Unknown.pipe(Schema.decodeTo(typed));
    expect(() => Schema.decodeUnknownSync(wrapped)([{ kind: "future" }])).toThrow();
    const jsonTyped = Schema.toCodecJson(typed);
    expect(fromWire(jsonTyped)([{ kind: "dated", at, name: "a", count: 7 }])).toEqual([
      { kind: "dated", at: DateTime.makeUnsafe(at), name: "a", count: 7 },
    ]);
    expect(() => fromWire(jsonTyped)([{ kind: "future" }])).toThrow();
  });

  it("preserves member constructor defaults without accepting them in is or decoding", () => {
    const Defaulted = Schema.Struct({
      kind: Schema.Literal("defaulted"),
      count: Schema.Number.pipe(Schema.withConstructorDefault(Effect.succeed(7))),
    });
    const array = ForwardCompatibleUnionArray([Defaulted], "kind");
    const plain = Schema.Array(Defaulted);
    expect(array.make([{ kind: "defaulted" }])).toEqual(plain.make([{ kind: "defaulted" }]));
    expect(Schema.is(array)([{}])).toBe(false);
    expect(() => Schema.decodeUnknownSync(array)([{ kind: "defaulted" }])).toThrow();
    expect(array.make([{ kind: "defaulted", count: 2 }])).toEqual(
      plain.make([{ kind: "defaulted", count: 2 }]),
    );
  });

  it("validates projected envelopes and known payloads once, including skipped rows", () => {
    let envelopeChecks = 0;
    let itemChecks = 0;
    const Item = Schema.Struct({
      kind: Schema.Literal("known"),
      value: Schema.Number.check(
        Schema.makeFilter(() => {
          itemChecks++;
          return true;
        }),
      ),
    });
    const Row = Schema.Struct({
      position: Schema.Number.check(
        Schema.makeFilter(() => {
          envelopeChecks++;
          return true;
        }),
      ),
      item: Item,
    });
    const rows = filterDecodedArray(
      Row,
      Row.mapFields((fields) => ({ ...fields, item: ForwardCompatibleUnion([Item], "kind") })),
      (row) => !isUnknownUnionMember(row.item),
    );
    for (const codec of [rows, Schema.toCodecJson(rows)]) {
      envelopeChecks = itemChecks = 0;
      expect(
        Schema.decodeUnknownSync(codec)([
          { position: 0, item: { kind: "future" } },
          { position: 1, item: { kind: "known", value: 1 } },
        ]),
      ).toEqual([{ position: 1, item: { kind: "known", value: 1 } }]);
      expect(envelopeChecks).toBe(2);
      expect(itemChecks).toBe(1);
      expect(() =>
        Schema.decodeUnknownSync(codec)([{ position: "bad", item: { kind: "future" } }]),
      ).toThrow();
    }
  });
});

describe("trimmed non-empty strings", () => {
  const entityIds = [
    "ThreadId",
    "ProjectId",
    "EnvironmentId",
    "CommandId",
    "EventId",
    "MessageId",
    "TurnId",
    "RunId",
    "RunAttemptId",
    "NodeId",
    "AuthSessionId",
    "ProviderItemId",
    "ProviderSessionId",
    "ProviderThreadId",
    "ProviderTurnId",
    "RuntimeSessionId",
    "RuntimeItemId",
    "TurnItemId",
    "RuntimeRequestId",
    "RuntimeTaskId",
    "ScheduledTaskId",
    "ApprovalRequestId",
    "CheckpointRef",
    "CheckpointId",
    "CheckpointScopeId",
    "ContextHandoffId",
    "ContextTransferId",
    "RawEventId",
    "PlanId",
  ] as const;
  const schemas = [
    ["TrimmedNonEmptyString", TrimmedNonEmptyString],
    ...entityIds.map((name) => [name, BaseSchemas[name]] as const),
  ] as const;

  // Schema-derived strings are rarely padded, so pad them with every kind of
  // whitespace `trim()` removes, and include whitespace-only values.
  const whitespace = Arbitrary.schema(
    Schema.Literals([" ", "\t", "\n", "\r\n", "\v", "\f", "\u00a0", "\u2028", "\u3000", "\ufeff"]),
  );
  const padding = Arbitrary.array(whitespace, { maxLength: 4 }).pipe(
    Arbitrary.map((parts) => parts.join("")),
  );
  const paddedString = Arbitrary.all([padding, Arbitrary.schema(Schema.String), padding]).pipe(
    Arbitrary.map(([before, value, after]) => before + value + after),
  );
  const options = { arbitrary: { runs: 500 } };

  for (const [name, schema] of schemas) {
    const make = schema.makeOption;
    const encode = Schema.encodeUnknownExit(schema);
    const decode = Schema.decodeExit(schema);

    it.prop(
      `${name}: whatever make accepts encodes to something that decodes back`,
      [paddedString],
      ([input]) => {
        const made = make(input);
        if (made._tag === "None") {
          expect(input.trim()).toBe("");
          return;
        }
        const encoded = encode(made.value);
        expect(encoded).toStrictEqual(Exit.succeed(input.trim()));
        expect(decode(input.trim())).toStrictEqual(Exit.succeed(input.trim()));
      },
      options,
    );

    it.prop(
      `${name}: decoding then encoding is stable`,
      [paddedString],
      ([input]) => {
        const decoded = decode(input);
        if (Exit.isFailure(decoded)) {
          expect(input.trim()).toBe("");
          expect(Exit.isFailure(encode(input))).toBe(true);
          return;
        }
        expect(decoded.value).toBe(input.trim());
        expect(encode(decoded.value)).toStrictEqual(Exit.succeed(decoded.value));
      },
      options,
    );

    it.prop(
      `${name}: generated values round-trip`,
      [schema],
      ([value]) => {
        const encoded = encode(value);
        expect(Exit.isSuccess(encoded)).toBe(true);
        if (Exit.isSuccess(encoded))
          expect(decode(encoded.value)).toStrictEqual(Exit.succeed(value.trim()));
      },
      options,
    );
  }

  const isThreadId = Schema.is(BaseSchemas.ThreadId);
  const encodeThreadId = Schema.encodeUnknownExit(BaseSchemas.ThreadId);
  const decodeThreadId = Schema.decodeExit(BaseSchemas.ThreadId);

  it("rejects whitespace-only values everywhere", () => {
    for (const value of [" ", "\t\n", "\u00a0\u3000"]) {
      expect(() => BaseSchemas.ThreadId.make(value)).toThrow();
      expect(isThreadId(value)).toBe(false);
      expect(Exit.isFailure(encodeThreadId(value))).toBe(true);
      expect(Exit.isFailure(decodeThreadId(value))).toBe(true);
    }
  });

  it("keeps the encoded form and JSON Schema of valid values", () => {
    expect(encodeThreadId(BaseSchemas.ThreadId.make("thread-1"))).toStrictEqual(
      Exit.succeed("thread-1"),
    );
    expect(encodeThreadId("  a b  ")).toStrictEqual(Exit.succeed("a b"));
    expect(Schema.toJsonSchemaDocument(Schema.toType(BaseSchemas.ThreadId)).schema).toEqual({
      type: "string",
      minLength: 1,
    });
  });
});
