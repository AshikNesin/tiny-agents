package groot.mobile

import android.app.Application
import android.content.Context
import groot.kit.buildinfo.BuildInfo
import groot.kit.log.Log
import groot.kit.theme.ThemeModeStore
import groot.mobile.data.AppLinks
import groot.mobile.data.AppPreferences
import groot.mobile.data.AvatarStore
import groot.mobile.data.BotsStore
import groot.mobile.data.FileActions
import groot.mobile.data.ImageStore
import groot.mobile.data.LivePip
import groot.mobile.data.Notices
import groot.mobile.data.SessionStore
import groot.mobile.data.ShareTarget
import groot.mobile.data.ShareTargets
import groot.mobile.data.FingerprintPassword
import groot.mobile.data.StepUp
import groot.mobile.data.api.ApiClient
import groot.mobile.data.api.CodeApi
import groot.mobile.data.api.TinyAgentsApi
import groot.mobile.data.chat.ChatStore
import groot.mobile.data.shareTargetBots
import groot.mobile.push.ApprovalAnswerer
import groot.mobile.push.PushNotifier
import groot.mobile.push.PushRegistrar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class GrootMobileApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        Log.enabled = BuildConfig.DEBUG
        container = AppContainer(this)
    }
}

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val themeModeStore: ThemeModeStore = ThemeModeStore.create(appContext)

    val appPreferences: AppPreferences = AppPreferences.create(appContext)

    val buildInfo: BuildInfo by lazy { BuildInfo.from(appContext, commit = BuildConfig.GIT_COMMIT) }

    val notices = Notices()

    val session: SessionStore = SessionStore.create(appContext, scope)

    private val client = ApiClient(session)

    val api = TinyAgentsApi(client)

    val code = CodeApi(client)

    val bots = BotsStore(api, scope, notices)

    val chats = ChatStore(api, scope, notices)

    val images = ImageStore(api)

    val avatars = AvatarStore(appContext.cacheDir)

    val files = FileActions(appContext, api)

    val stepUp = StepUp(api)

    val fingerprint = FingerprintPassword(appContext)

    val links = AppLinks()

    val livePip = LivePip()

    val pushNotifier = PushNotifier(appContext)

    val push = PushRegistrar(appContext, api, session)

    val approvalAnswerer = ApprovalAnswerer(api, pushNotifier, session)

    suspend fun ensureSessionLoaded() {
        if (!session.state.value.signedIn) session.load()
    }

    val shareTargets = ShareTargets(appContext, avatars)

    init {
        scope.launch {
            session.state.map { it.signedIn to it.serverUrl }.distinctUntilChanged().collect { (signedIn, _) ->
                bots.stop()
                chats.clear()
                images.clear()
                stepUp.clear()
                if (signedIn) bots.start()
            }
        }
        scope.launch {
            combine(session.state, bots.state) { session, bots ->
                when {
                    !session.signedIn -> emptyList<ShareTarget>() to null
                    bots.loading -> null
                    else -> shareTargetBots(bots, shareTargets.max).map { ShareTarget(it.id, it.name) } to session.serverUrl
                }
            }.filterNotNull().distinctUntilChanged().collectLatest { (targets, serverUrl) -> shareTargets.publish(targets, serverUrl) }
        }
    }
}
