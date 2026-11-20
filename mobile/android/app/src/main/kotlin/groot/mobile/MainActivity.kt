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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import groot.mobile.push.PushStatus
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
import kotlinx.coroutines.flow.merge
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

        val initialMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ThemeMode.System
        } else {
            runBlocking { store.current() }
        }
        runBlocking { container.session.load() }
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

    private var askedPermission = false

    private fun registerForPush() {
        val container = (application as GrootMobileApp).container
        container.pushNotifier.createChannels()
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                val signedIn = container.session.state
                    .map { if (it.signedIn) it.serverUrl else null }
                    .distinctUntilChanged()
                    .filter { it != null }
                    .map { false }
                val retried = container.push.retries.map { true }
                merge(signedIn, retried).collect { explicit ->
                    if (!container.session.state.value.signedIn) return@collect
                    if (explicit) askedPermission = false
                    val on = container.push.status.value.state == PushStatus.State.On
                    if (!explicit && on && container.pushNotifier.enabled()) return@collect
                    container.push.ensure(::askNotificationPermission)
                }
            }
        }
    }

    private suspend fun askNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return true
        if (askedPermission) return false
        askedPermission = true
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
