package groot.mobile.feature.code

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.PullCheck
import groot.mobile.data.api.PullView
import groot.mobile.data.api.ThreadPulls
import groot.mobile.data.code.CodeWorkflow
import groot.mobile.data.code.codeWorkflows
import groot.mobile.feature.chat.openLink
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.relativeTime

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CodePullRoute(container: AppContainer, threadId: String, onBack: () -> Unit) {
    val api = container.code
    var latest by remember { mutableStateOf<ThreadPulls?>(null) }
    val resource = rememberResource("code-pr:$threadId") { api.pulls(threadId).also { latest = null } }
    val context = LocalContext.current
    var merging by remember { mutableStateOf<String?>(null) }
    var linking by remember { mutableStateOf(false) }
    fun act(failure: String, block: suspend () -> ThreadPulls) = resource.act(failure) { latest = block() }

    ScreenScaffold(
        title = "Pull request",
        onBack = onBack,
        actions = { IconBtn(AppIcons.Refresh, "Refresh from GitHub", resource::refresh) },
    ) {
        LoadableContent(resource) { loaded ->
            val view = latest ?: loaded
            ScreenColumn {
                view.project?.let { project ->
                    Text(
                        listOfNotNull(project.repo, view.branch?.let { "$it into ${project.baseBranch}" }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                val pr = view.active
                if (pr == null || pr.state == "merged" || pr.state == "closed") {
                    Publish(view, onPublish = { act("Could not publish.") { api.publish(threadId) } }, onLink = { linking = true })
                }
                if (pr != null) {
                    PullHeader(pr, onOpen = { openLink(context, null, pr.url) })
                    if (pr.state == "open") {
                        view.ahead?.takeIf { it > 0 }?.let { ahead ->
                            SecondaryButton("Push $ahead new ${if (ahead == 1) "commit" else "commits"}", onClick = { act("Could not push.") { api.publish(threadId) } }, icon = AppIcons.ArrowUp)
                        }
                        Checks(pr.checks, pr.stalled, onOpen = { openLink(context, null, it) })
                        Reviews(pr)
                        AutofixCard(
                            pr = pr,
                            onAutofix = { enabled -> act("Could not change Auto-fix.") { api.setAutofix(threadId, enabled) } },
                            onWorkflow = { workflow ->
                                resource.act("Could not start ${workflow.label}.") {
                                    val result = api.runWorkflow(threadId, workflow.wire)
                                    result.view?.let { latest = it }
                                    container.notices.show(
                                        if (result.started) "${workflow.label} started. The agent works in this thread." else result.reason ?: "Nothing to do.",
                                    )
                                }
                            },
                        )
                        if (pr.mergeMethods.isNotEmpty()) {
                            SectionLabel("Merge")
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                                for (method in pr.mergeMethods) {
                                    SecondaryButton(mergeLabel(method), onClick = { merging = method })
                                }
                            }
                            if (pr.mergeable == "conflicting") Text("This branch has conflicts with ${pr.baseRef}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                    SecondaryButton("Unlink", onClick = { act("Could not unlink.") { api.unlinkPull(threadId) } }, destructive = true)
                }
                if (view.earlier.isNotEmpty()) {
                    SectionLabel("Earlier pull requests")
                    for ((number, title) in view.earlier) {
                        Text("#$number $title", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    merging?.let { method ->
        ConfirmDialog(
            title = "${mergeLabel(method)}?",
            text = "This merges the pull request on GitHub.",
            confirmLabel = mergeLabel(method),
            onConfirm = {
                merging = null
                act("Could not merge.") { api.merge(threadId, method) }
            },
            onDismiss = { merging = null },
        )
    }
    if (linking) {
        var number by remember { mutableStateOf("") }
        groot.mobile.ui.components.Sheet(onDismiss = { linking = false }, title = "Link a pull request") {
            Field(number, { number = it.filter(Char::isDigit) }, placeholder = "Number", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            PrimaryButton("Link", enabled = number.toIntOrNull() != null, onClick = {
                linking = false
                number.toIntOrNull()?.let { n -> act("Could not link the pull request.") { api.linkPull(threadId, n) } }
            })
        }
    }
}

@Composable
private fun Publish(view: ThreadPulls, onPublish: () -> Unit, onLink: () -> Unit) {
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
            Text("Publish this branch", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(
                when (val ahead = view.ahead) {
                    null -> "Pushes the branch and opens a draft pull request with its commits."
                    0 -> "Nothing to publish yet: the branch has no commits beyond its base."
                    else -> "$ahead ${if (ahead == 1) "commit" else "commits"} to push, then a draft pull request."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                PrimaryButton("Publish draft PR", onClick = onPublish, enabled = view.ahead != 0, icon = AppIcons.ArrowUp)
                SecondaryButton("Link existing", onClick = onLink)
            }
        }
    }
}

@Composable
private fun PullHeader(pr: PullView, onOpen: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = "Open on GitHub", onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
            Text("#${pr.number}", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(pr.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            AppIcon(AppIcons.External, "Open on GitHub", tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
        }
        val state = when {
            pr.state == "merged" -> "Merged"
            pr.state == "closed" -> "Closed"
            pr.inMergeQueue -> "Queued to merge"
            pr.draft -> "Draft"
            else -> "Open"
        }
        Text("$state · ${pr.headRef} into ${pr.baseRef}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Checks(checks: List<PullCheck>, stalled: List<String>, onOpen: (String) -> Unit) {
    if (checks.isEmpty()) return
    val failed = checks.count { it.state == "failure" }
    val pending = checks.count { it.state == "pending" && it.name !in stalled }
    SectionLabel(
        when {
            failed > 0 -> "Checks: $failed failed"
            pending > 0 -> "Checks: $pending running"
            else -> "Checks: all passed"
        },
    )
    for (check in checks.sortedBy { CHECK_ORDER.indexOf(it.state) }) {
        Row(
            Modifier.fillMaxWidth().then(if (check.url != null) Modifier.clickable(role = Role.Button) { onOpen(check.url) } else Modifier).padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(
                when (check.state) {
                    "success" -> Accents.success
                    "failure" -> MaterialTheme.colorScheme.error
                    "pending" -> Accents.warning
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Text(check.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(if (check.name in stalled) "stalled" else check.state, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Reviews(pr: PullView) {
    val reviews = pr.reviews.filter { it.state == "APPROVED" || it.state == "CHANGES_REQUESTED" }
    if (reviews.isEmpty() && pr.threads.isEmpty()) return
    SectionLabel("Reviews")
    for (review in reviews.distinctBy { it.author }) {
        Text(
            "${review.author}: ${if (review.state == "APPROVED") "approved" else "requested changes"}",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    for (thread in pr.threads) {
        AppCard(padding = androidx.compose.foundation.layout.PaddingValues(S.md)) {
            Text(
                listOfNotNull(thread.path + (thread.line?.let { ":$it" } ?: ""), thread.author, "Ignored".takeIf { thread.id in pr.ignored }).joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(thread.body, style = MaterialTheme.typography.bodyMedium, maxLines = 6, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AutofixCard(
    pr: PullView,
    onAutofix: (Boolean) -> Unit,
    onWorkflow: (CodeWorkflow) -> Unit,
) {
    AppCard {
        Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
            Toggle("Auto-fix", loopText(pr), pr.autofix, onAutofix)
            val workflows = codeWorkflows(pr)
            if (pr.loopStatus != "fixing" && workflows.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                    for (workflow in workflows) SecondaryButton(workflow.label, onClick = { onWorkflow(workflow) }, icon = AppIcons.Zap)
                }
            }
            for (pass in pr.passes.take(MAX_PASSES)) {
                Text(
                    "${relativeTime(pass.createdAt)}: ${pass.trigger}, ${pass.outcome ?: pass.status}" + (pass.detail?.let { ". $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun Toggle(title: String, summary: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary, checkedThumbColor = MaterialTheme.colorScheme.onPrimary),
        )
    }
}

internal fun loopText(pr: PullView): String {
    if (!pr.autofix) return "Off. Fix failed checks and trusted review comments on its own."
    val status = when (pr.loopStatus) {
        "watching" -> "Watching checks and reviews"
        "fixing" -> "Fixing now"
        "needs_input" -> "Stopped for you"
        "green" -> "Green: nothing to fix"
        "paused" -> "Paused: too many passes this hour"
        "merged" -> "Merged"
        else -> "Off"
    }
    return pr.loopReason?.let { "$status. $it" } ?: status
}

private fun mergeLabel(method: String): String = when (method) {
    "squash" -> "Squash and merge"
    "rebase" -> "Rebase and merge"
    else -> "Merge"
}

private val CHECK_ORDER = listOf("failure", "pending", "neutral", "success")
private const val MAX_PASSES = 5
