package groot.mobile.feature.bots

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.chat.ChatHealth
import groot.mobile.data.chat.ChatStore
import groot.mobile.data.chat.chatView
import groot.mobile.feature.chat.ChatActions
import groot.mobile.feature.chat.Transcript
import groot.mobile.feature.chat.openCardLink
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.dateTime
import groot.mobile.ui.components.rememberResource

@Composable
fun PastChatsRoute(container: AppContainer, botId: String, onOpen: (chatId: String) -> Unit, onBack: () -> Unit) {
    val resource = rememberResource("past-chats:$botId") { container.api.pastChats(botId) }
    ScreenScaffold(title = "Past chats", onBack = onBack) {
        LoadableContent(resource) { chats ->
            if (chats.isEmpty()) {
                EmptyState("No past chats", body = "Starting a new chat moves the current one here.", icon = AppIcons.History)
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(S.lg),
                    verticalArrangement = Arrangement.spacedBy(S.sm),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(chats, key = { it.id }) { chat ->
                        AppCard(onClick = { onOpen(chat.id) }) {
                            Text(
                                chat.title ?: "Untitled chat",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (chat.lastMessagePreview != null) {
                                Text(
                                    chat.lastMessagePreview,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Text(
                                "${dateTime(chat.endedAt)} · ${chat.messageCount} messages",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = S.xs),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PastChatRoute(container: AppContainer, botId: String, chatId: String, onContinued: () -> Unit, onBack: () -> Unit) {
    val key = ChatStore.pastChatKey(botId, chatId)
    DisposableEffect(key) {
        container.chats.openPast(botId, chatId)
        onDispose { container.chats.dropPast(key) }
    }
    val sessions by container.chats.sessions.collectAsStateWithLifecycle()
    val bots by container.bots.state.collectAsStateWithLifecycle()
    val session = sessions[key]
    val view = remember(session) { session?.let { chatView(it) } }
    val context = LocalContext.current
    val botName = bots.bot(botId)?.name ?: "The bot"
    var confirmDelete by remember { mutableStateOf(false) }
    val actions = remember(botName, bots.labels) {
        ChatActions(
            botName = botName,
            labels = bots.labels,
            askOnlyTools = emptySet(),
            readOnly = true,
            now = System::currentTimeMillis,
            onDecide = { _, _, _, _ -> },
            onAnswer = { _, _ -> },
            onOpenCredentials = {},
            onCancelCredentials = {},
            onOpenComputer = {},
            onOpenLink = { openCardLink(container, context, it) },
        )
    }
    val resource = rememberResource("past-chat-actions:$key") { }
    ScreenScaffold(
        title = view?.past?.title ?: "Past chat",
        subtitle = view?.past?.let { dateTime(it.endedAt) },
        onBack = onBack,
        actions = { IconBtn(AppIcons.Trash, "Delete this chat", onClick = { confirmDelete = true }) },
    ) {
        if (view == null || view.health == ChatHealth.Loading) {
            LoadingBox()
        } else {
            Column(Modifier.fillMaxSize()) {
                Transcript(
                    view = view,
                    actions = actions,
                    listState = rememberLazyListState(),
                    onLoadOlder = { container.chats.loadOlder(key) },
                    onOpenImage = {},
                    onSaveFile = {},
                    onCopy = {},
                    modifier = Modifier.weight(1f),
                )
                PrimaryButton(
                    "Continue this chat",
                    icon = AppIcons.History,
                    modifier = Modifier.fillMaxWidth().padding(S.lg),
                    onClick = {
                        resource.act("Could not continue the chat.", done = onContinued) {
                            container.api.continuePastChat(botId, chatId)
                            container.bots.refresh()
                        }
                    },
                )
            }
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this chat?",
            text = "Its messages are removed for good.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                confirmDelete = false
                resource.act("Could not delete the chat.", done = onBack) { container.api.deletePastChat(botId, chatId) }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}
