import Capacitor

class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeApplePayPlugin())
        bridge?.registerPluginInstance(NativeDeliveryLiveActivityPlugin())
    }
}
