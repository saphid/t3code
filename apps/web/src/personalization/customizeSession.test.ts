import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useCustomizeSession } from "./customizeSession";

const resetStore = () => {
  useCustomizeSession.setState({
    available: { composer: false, "thread-rows": false, "thread-details": false },
    pendingOpen: null,
  });
};

describe("useCustomizeSession", () => {
  beforeEach(resetStore);

  it("tracks availability per surface", () => {
    expect(useCustomizeSession.getState().available).toEqual({
      composer: false,
      "thread-rows": false,
      "thread-details": false,
    });
    useCustomizeSession.getState().setAvailable("composer", true);
    expect(useCustomizeSession.getState().available.composer).toBe(true);
    expect(useCustomizeSession.getState().available["thread-details"]).toBe(false);
    useCustomizeSession.getState().setAvailable("composer", false);
    expect(useCustomizeSession.getState().available.composer).toBe(false);
  });

  it("delivers a pending open exactly once", () => {
    useCustomizeSession.getState().requestOpen("thread-rows");
    expect(useCustomizeSession.getState().consumePendingOpen("thread-rows")).toBe(true);
    expect(useCustomizeSession.getState().consumePendingOpen("thread-rows")).toBe(false);
  });

  it("leaves the request alone when another surface consumes", () => {
    useCustomizeSession.getState().requestOpen("composer");
    expect(useCustomizeSession.getState().consumePendingOpen("thread-details")).toBe(false);
    expect(useCustomizeSession.getState().consumePendingOpen("composer")).toBe(true);
  });

  it("replaces an earlier pending request", () => {
    useCustomizeSession.getState().requestOpen("composer");
    useCustomizeSession.getState().requestOpen("thread-details");
    expect(useCustomizeSession.getState().consumePendingOpen("composer")).toBe(false);
    expect(useCustomizeSession.getState().consumePendingOpen("thread-details")).toBe(true);
  });
});
