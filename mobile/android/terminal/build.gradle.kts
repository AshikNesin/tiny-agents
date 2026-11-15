// APP-owned module: the terminal emulator and view behind the Terminal screen.
// No networking and no app code in here: the app hands it bytes and gets bytes back.
plugins {
    alias(libs.plugins.groot.android.library)
    alias(libs.plugins.groot.compose)
    alias(libs.plugins.groot.test)
}

android {
    namespace = "tinyagents.terminal"
}

dependencies {
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
}

// The tmux differential test runs only with TERMINAL_TMUX_TEST=1: make the variable an input so
// flipping it reruns the tests instead of reusing an up-to-date result.
tasks.withType<Test>().configureEach {
    inputs.property("terminalTmuxTest", providers.environmentVariable("TERMINAL_TMUX_TEST").orElse(""))
}
