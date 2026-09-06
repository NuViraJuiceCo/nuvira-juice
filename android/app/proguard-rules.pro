# Capacitor's consumer rules preserve plugins, PluginMethod entry points, and
# activity/permission callbacks (including our Google Pay and delivery plugins).
# Preserve their runtime annotations; do not keep the entire application/SDKs.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# R8 full mode must retain the annotation interfaces and their default members,
# not only the attributes on plugin classes. Capacitor reads nested permission
# metadata at runtime; dropping it crashes notification/location permission reads.
-keep @interface com.getcapacitor.annotation.** { *; }
-keep @interface com.getcapacitor.PluginMethod { *; }
-keep @interface com.getcapacitor.NativePlugin { *; }

# WebView calls these methods by name, outside Java's static call graph.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep release crash reports useful alongside the generated mapping.txt.
-keepattributes SourceFile,LineNumberTable
