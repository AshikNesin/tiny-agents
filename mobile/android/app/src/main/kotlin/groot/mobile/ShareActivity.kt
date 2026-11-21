package groot.mobile

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.GrootTheme
import groot.mobile.data.parseShareIntent
import groot.mobile.feature.share.ShareOutcome
import groot.mobile.feature.share.ShareRoute
import groot.mobile.feature.share.ShareViewModel
import groot.mobile.ui.brand.BrandPalette
import groot.mobile.ui.components.LocalAvatars
import groot.mobile.ui.components.LocalContainer
import kotlinx.coroutines.runBlocking

class ShareActivity : ComponentActivity() {
    private val viewModel: ShareViewModel by viewModels {
        viewModelFactory { initializer { ShareViewModel((application as GrootMobileApp).container) } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as GrootMobileApp).container
        val content = parseShareIntent(intent)
        if (content == null) {
            finish()
            return
        }
        if (!container.session.state.value.signedIn) runBlocking { container.session.load() }
        val initialMode = runBlocking { container.themeModeStore.current() }
        viewModel.start(content)

        setContent {
            val themeMode by container.themeModeStore.themeMode.collectAsStateWithLifecycle(initialValue = initialMode)
            GrootTheme(mode = themeMode, palette = BrandPalette) {
                CompositionLocalProvider(
                    LocalContainer provides container,
                    LocalAvatars provides container.avatars,
                    LocalContentColor provides MaterialTheme.colorScheme.onBackground,
                ) {
                    ShareRoute(
                        container = container,
                        viewModel = viewModel,
                        onDone = ::done,
                        onCancel = ::finish,
                        onOpenApp = {
                            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            finish()
                        },
                    )
                }
            }
        }
    }

    private fun done(outcome: ShareOutcome) {
        val text = when (outcome) {
            is ShareOutcome.Sent -> "Sent to ${outcome.botName}"
            is ShareOutcome.Pending -> "Sending to ${outcome.botName} when you are back online"
        }
        Toast.makeText(applicationContext, text, Toast.LENGTH_SHORT).show()
        finish()
    }
}
