package groot.mobile.feature.code

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.INBOX_SECTIONS
import groot.mobile.data.api.InboxPull
import groot.mobile.data.api.CodeReview
import groot.mobile.data.api.inboxBadge
import groot.mobile.feature.chat.openLink
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.shortDate

data class ReviewsOverview(val open: List<CodeReview>, val inbox: List<InboxPull>?, val inboxError: String?)

private const val UNOPENABLE_ALPHA = 0.6f

@Composable
fun ReviewsRoute(container: AppContainer, onOpen: (String) -> Unit, onBack: () -> Unit) {
    val resource = rememberResource("code-reviews") {
        val open = container.code.reviews()
        val inbox = runCatching { container.code.reviewInbox() }
        ReviewsOverview(open, inbox.getOrNull(), inbox.exceptionOrNull()?.message)
    }
    val context = LocalContext.current
    var link by remember { mutableStateOf("") }
    val openPull: (String) -> Unit = { pr ->
        resource.act("Could not open that pull request.") { onOpen(container.code.openReview(pr).id) }
    }
    ScreenScaffold(title = "Reviews", onBack = onBack, actions = { IconBtn(AppIcons.Refresh, "Refresh", resource::refresh) }) {
        LoadableContent(resource) { overview ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.xs)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
                        Field(
                            link,
                            { link = it },
                            Modifier.weight(1f),
                            placeholder = "Pull request link, or owner/name#123",
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { if (link.isNotBlank()) openPull(link.trim()) }),
                        )
                        PrimaryButton("Open", enabled = link.isNotBlank(), onClick = { openPull(link.trim()) })
                    }
                }
                if (overview.open.isNotEmpty()) {
                    item { SectionLabel("Open reviews", Modifier.padding(top = S.md)) }
                    items(overview.open, key = { "open:${it.id}" }) { review ->
                        PullRow(
                            number = review.number,
                            title = review.title,
                            meta = "${review.repo} · @${review.author}",
                            badge = "New commits".takeIf { review.hasNewCommits },
                            onClick = { onOpen(review.id) },
                            trailing = {
                                IconBtn(AppIcons.Close, "Close review of #${review.number}", onClick = {
                                    resource.act("Could not close the review.") { container.code.archiveReview(review.id) }
                                })
                            },
                        )
                    }
                }
                when {
                    overview.inboxError != null -> item { Hint("GitHub inbox: ${overview.inboxError}") }
                    overview.inbox.isNullOrEmpty() -> item { Hint("Nothing asks for your review on GitHub right now.") }
                    else -> for ((section, title) in INBOX_SECTIONS) {
                        val rows = overview.inbox.filter { it.section == section }
                        if (rows.isEmpty()) continue
                        item(key = "section:$section") { SectionLabel("$title ${rows.size}", Modifier.padding(top = S.md)) }
                        items(rows, key = { "$section:${it.url}" }) { pull ->
                            val openable = pull.reviewId != null || pull.projectId != null
                            PullRow(
                                number = pull.number,
                                title = pull.title,
                                meta = "${pull.repo} · @${pull.author} · ${shortDate(pull.updatedAt)}",
                                badge = inboxBadge(pull),
                                onClick = if (openable) {
                                    { pull.reviewId?.let(onOpen) ?: openPull(pull.url) }
                                } else {
                                    null
                                },
                                trailing = { IconBtn(AppIcons.External, "Open #${pull.number} on GitHub", onClick = { openLink(context, null, pull.url) }) },
                            )
                        }
                    }
                }
                if (overview.inbox?.any { it.projectId == null && it.reviewId == null } == true) {
                    item { Hint("Dimmed pull requests are in repositories that aren't Code projects yet. Add them in Code settings on the web to review them here.") }
                }
            }
        }
    }
}

@Composable
private fun PullRow(number: Int, title: String, meta: String, badge: String?, onClick: (() -> Unit)?, trailing: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier.alpha(UNOPENABLE_ALPHA))
            .padding(vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("#$number $title", style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(badge, meta).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        trailing()
    }
}

@Composable
internal fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}
