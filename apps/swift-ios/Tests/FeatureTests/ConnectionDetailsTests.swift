import Testing
@testable import T3Code

@Suite("Connection details")
struct ConnectionDetailsTests {
    @Test
    func parsesRawPairingURL() throws {
        let details = try ConnectionDetailsParser.parse(
            "http://192.168.1.42:3773/pair#token=PAIRCODE"
        )

        #expect(details.endpoint == "http://192.168.1.42:3773")
        #expect(details.pairingCode == "PAIRCODE")
    }

    @Test(
        "Wildcard links keep their code for repair without becoming pairable",
        .bug("https://github.com/saphid/t3code-personal/issues/221"),
        arguments: [
            "http://0.0.0.0:3773/pair#token=PAIRCODE",
            "http://[::]:3773/pair#token=PAIRCODE",
        ]
    )
    func rejectsWildcardDestinationBeforePairing(_ link: String) throws {
        let details = try ConnectionDetailsParser.parse(link)

        #expect(details.pairingCode == "PAIRCODE")
        #expect(throws: ConnectionDetailsError.wildcardAddress) {
            try ConnectionDetailsParser.validatePairingEndpoint(details.endpoint)
        }
    }

    @Test(
        "Reachable address forms remain normalized",
        .bug("https://github.com/saphid/t3code-personal/issues/221"),
        arguments: [
            ("http://172.18.0.2:3773/pair#token=C", "http://172.18.0.2:3773"),
            ("http://192.168.1.42:3773/pair#token=C", "http://192.168.1.42:3773"),
            ("http://100.64.0.7:3773/pair#token=C", "http://100.64.0.7:3773"),
            ("https://relay.example.com/pair#token=C", "https://relay.example.com"),
            ("https://tunnel.example.com/t3/pair#token=C", "https://tunnel.example.com/t3"),
            ("https://[2001:db8::7]:8443/t3/pair#token=C", "https://[2001:db8::7]:8443/t3"),
        ]
    )
    func acceptsExplicitDestinations(input: String, expected: String) throws {
        let details = try ConnectionDetailsParser.parse(input)
        try ConnectionDetailsParser.validatePairingEndpoint(details.endpoint)

        #expect(details.endpoint == expected)
        #expect(details.pairingCode == "C")
    }

    @Test
    func parsesHostedPairingURL() throws {
        let details = try ConnectionDetailsParser.parse(
            "https://app.t3.codes/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=PAIRCODE"
        )

        #expect(details.endpoint == "https://desktop.tailnet.ts.net")
        #expect(details.pairingCode == "PAIRCODE")
    }

    @Test(arguments: [
        "t3code://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
        "t3code:?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
        "t3code-swiftui://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
        "t3code-swiftui-dev://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
    ])
    func unwrapsMobileQRCode(_ payload: String) throws {
        let details = try ConnectionDetailsParser.parse(payload)

        #expect(details.endpoint == "https://remote.example.com")
        #expect(details.pairingCode == "pairing-token")
    }

    @Test(arguments: [
        "t3code-swiftui-personal-dev",
        "t3code-swiftui-personal",
    ])
    func extractsRegisteredPersonalPairingURLFromSurroundingText(_ scheme: String) throws {
        let policy = try #require(NativeURLSchemePolicy(infoDictionary: [
            "T3URLScheme": scheme,
            "CFBundleURLTypes": [[
                "CFBundleURLSchemes": [scheme],
            ]],
        ]))
        let details = try ConnectionDetailsParser.parse(
            "Pairing URL: \(scheme)://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token.",
            schemePolicy: policy
        )

        #expect(details.endpoint == "https://remote.example.com")
        #expect(details.pairingCode == "pairing-token")
    }

    @Test
    func rejectsUnregisteredAndMalformedNativePairingSchemes() throws {
        let policy = try #require(NativeURLSchemePolicy(infoDictionary: [
            "T3URLScheme": "t3code-swiftui-personal-dev",
            "CFBundleURLTypes": [[
                "CFBundleURLSchemes": ["t3code-swiftui-personal-dev"],
            ]],
        ]))

        #expect(throws: ConnectionDetailsError.unsupportedScheme) {
            try ConnectionDetailsParser.parse(
                "t3code-swiftui-unrelated://pair?endpoint=https%3A%2F%2Fremote.example.com",
                schemePolicy: policy
            )
        }
        #expect(throws: ConnectionDetailsError.invalidAddress) {
            try ConnectionDetailsParser.parse(
                "t3code_swiftui://pair?endpoint=https%3A%2F%2Fremote.example.com",
                schemePolicy: policy
            )
        }
    }

    @Test
    func proseExtractionUsesTheExactRegisteredSchemeGrammar() throws {
        let scheme = "t3code-swiftui+personal.dev"
        let policy = try #require(NativeURLSchemePolicy(infoDictionary: [
            "T3URLScheme": scheme,
            "CFBundleURLTypes": [["CFBundleURLSchemes": [scheme]]],
        ]))
        let details = try ConnectionDetailsParser.parse(
            "Open \(scheme)://pair?endpoint=https%3A%2F%2Fremote.example.com&token=PAIR.",
            schemePolicy: policy
        )

        #expect(details.endpoint == "https://remote.example.com")
        #expect(details.pairingCode == "PAIR")
    }

    @Test
    func extractsPairingURLFromSurroundingText() throws {
        let details = try ConnectionDetailsParser.parse(
            "Pairing URL: http://10.0.0.8:18773/pair#token=ABC123\nOpen this on your phone."
        )

        #expect(details.endpoint == "http://10.0.0.8:18773")
        #expect(details.pairingCode == "ABC123")
    }

    @Test(arguments: [
        "token",
        "pairing_token",
        "pairingToken",
        "pairing_code",
        "pairingCode",
        "code",
    ])
    func acceptsEveryPairingCodeQueryAlias(_ alias: String) throws {
        let details = try ConnectionDetailsParser.parse(
            "https://remote.example.com/pair?\(alias)=ABC123"
        )

        #expect(details.endpoint == "https://remote.example.com")
        #expect(details.pairingCode == "ABC123")
    }

    @Test
    func removesPunctuationCopiedWithAProseLink() throws {
        let details = try ConnectionDetailsParser.parse(
            "Connect with (https://remote.example.com/pair?code=ABC123). Then return."
        )

        #expect(details.endpoint == "https://remote.example.com")
        #expect(details.pairingCode == "ABC123")
    }

    @Test
    func keepsBalancedIPv6BracketsWhileTrimmingProse() throws {
        let details = try ConnectionDetailsParser.parse(
            "Use http://[fe80::1]:3773/pair?code=ABC123!"
        )

        #expect(details.endpoint == "http://[fe80::1]:3773")
        #expect(details.pairingCode == "ABC123")
    }

    @Test
    func splitsManualAddressAndCode() throws {
        let details = try ConnectionDetailsParser.parse("192.168.20.2:3773 ABC123")

        #expect(details.endpoint == "http://192.168.20.2:3773")
        #expect(details.pairingCode == "ABC123")
    }

    @Test
    func mapsCancellationToUsefulCopy() {
        let message = ConnectionErrorCopy.message(for: "cancelled")

        #expect(!message.lowercased().contains("cancelled"))
        #expect(message.contains("Make sure T3 Code is running"))
    }
}

@Suite("Local endpoint detection")
struct LocalEndpointDetectionTests {
    @Test(arguments: [
        "localhost",
        "studio.local",
        "127.0.0.1",
        "10.20.30.40",
        "172.20.10.2",
        "192.168.213.171",
        "[::1]",
        "::1",
        "[fe80::aede:48ff:fe00:1122]:3773",
        "fd12:3456:789a::1",
        "fc00::1",
    ])
    func recognizesLocalHosts(_ host: String) {
        #expect(EndpointNetworkScope.isLocalHost(host))
    }

    @Test(arguments: [
        "8.8.8.8",
        "172.32.0.1",
        "example.com",
        "2001:4860:4860::8888",
    ])
    func rejectsPublicHosts(_ host: String) {
        #expect(!EndpointNetworkScope.isLocalHost(host))
    }

    @Test
    func bracketsBareIPv6DuringNormalization() throws {
        let endpoint = try ConnectionDetailsParser.normalizedEndpoint("::1")

        #expect(endpoint == "http://[::1]")
    }
}
