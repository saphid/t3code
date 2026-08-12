enum DeviceManagementCopy {
    static func removeOtherDevicesTitle(count: Int) -> String {
        "Remove \(count) \(count == 1 ? "device" : "devices")"
    }
}
