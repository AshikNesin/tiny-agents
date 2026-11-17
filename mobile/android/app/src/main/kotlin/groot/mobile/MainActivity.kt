package groot.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import groot.kit.theme.GrootTheme
import groot.kit.theme.ThemeMode
import groot.mobile.data.parseAppLink
import groot.mobile.ui.brand.BrandPalette
import groot.mobile.ui.components.LocalAvatars
import groot.mobile.ui.components.LocalContainer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class MainActivity : ComponentActivity() {
    private var permissionAnswer: CompletableDeferred<Boolean>? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionAnswer?.complete(granted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as GrootMobileApp).container
        val store = container.themeModeStore

        // API 31+: ThemeModeStore mirrored the saved mode to UiModeManager, so the configuration
        // is already right and "System" renders the correct first frame. API 29–30: read the one
        // key before the first frame so a dark override never flashes light (RFC 0001 Q4).
        val initialMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ThemeMode.System
        } else {
            runBlocking { store.current() }
        }
        // The stored session decides the first screen (sign-in or chats): read it before the
        // first frame so a signed-in owner never sees the sign-in screen flash by.
        runBlocking { container.session.load() }
        // A cold start from a link; a running app gets it in onNewIntent (singleTask).
        if (savedInstanceState == null) openLink(intent)
        registerForPush()

        setContent {
            val themeMode by store.themeMode.collectAsStateWithLifecycle(initialValue = initialMode)
            GrootTheme(mode = themeMode, palette = BrandPalette) {
                CompositionLocalProvider(LocalContainer provides container, LocalAvatars provides container.avatars) {
                    TinyAgentsRoot(container)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openLink(intent)
    }

    /**
     * Phone notifications (issue #306): once signed in (each launch, and after a sign-in or a
     * switch of server), register this phone. The permission is asked only when the server
     * offers push, so a guest is never asked.
     */
    private fun registerForPush() {
        val container = (application as GrootMobileApp).container
        container.pushNotifier.createChannels()
        lifecycleScope.launch {
            container.session.state
                .map { if (it.signedIn) it.serverUrl else null }
                .distinctUntilChanged()
                .filter { it != null }
                .collect { container.push.ensure(this@MainActivity, ::askNotificationPermission) }
        }
    }

    private suspend fun askNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return true
        val answer = CompletableDeferred<Boolean>()
        permissionAnswer = answer
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        return answer.await()
    }

    private fun openLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val url = intent.dataString ?: return
        val container = (application as GrootMobileApp).container
        parseAppLink(url, container.session.serverUrl)?.let(container.links::open)
    }
}
