package com.nuvirajuice.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        registerPlugin(DeliveryLiveActivityPlugin.class);
        registerPlugin(NativeGooglePayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
