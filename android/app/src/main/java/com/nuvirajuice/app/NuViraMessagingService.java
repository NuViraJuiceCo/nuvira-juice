package com.nuvirajuice.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;

public class NuViraMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        DeliveryLiveActivityPlugin.handleRemoteMessage(getApplicationContext(), remoteMessage.getData());
        super.onMessageReceived(remoteMessage);
    }
}
