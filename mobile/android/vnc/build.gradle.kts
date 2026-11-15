// APP-owned module: the RFB (VNC) client and viewer behind the Browser and Computer live views.
// No networking and no app code in here: the app hands it bytes and gets bytes back.
plugins {
    alias(libs.plugins.groot.android.library)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
}

android {
    namespace = "tinyagents.vnc"
}

dependencies {
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
}
