package com.nuvirajuice.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(DeliveryLiveActivityPlugin.class);
        registerPlugin(NativeGooglePayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
