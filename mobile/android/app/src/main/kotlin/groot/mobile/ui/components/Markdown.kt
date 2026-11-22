package groot.mobile.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.toUri
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.parseAppLink
import groot.mobile.ui.brand.Dims

sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class ListItem(val marker: String, val depth: Int, val text: String) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
    data class Table(val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
private val BULLET = Regex("^(\\s*)[-*+]\\s+(.*)$")
private val ORDERED = Regex("^(\\s*)(\\d+)[.)]\\s+(.*)$")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private val TABLE_DIVIDER = Regex("^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")
private val FENCE = Regex("^\\s*(```|~~~)(.*)$")

private fun tableCells(line: String): List<String> =
    line.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }

fun parseMarkdown(source: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val paragraph = StringBuilder()
    fun flush() {
        if (paragraph.isNotBlank()) blocks.add(MdBlock.Paragraph(paragraph.toString().trim()))
        paragraph.setLength(0)
    }
    val lines = source.replace("\r\n", "\n").split('\n')
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val fence = FENCE.find(line)
        if (fence != null) {
            flush()
            val marker = fence.groupValues[1]
            val code = StringBuilder()
            i++
            while (i < lines.size && !lines[i].trim().startsWith(marker)) {
                if (code.isNotEmpty()) code.append('\n')
                code.append(lines[i])
                i++
            }
            i++
            blocks.add(MdBlock.Code(fence.groupValues[2].trim(), code.toString()))
            continue
        }
        if (line.isBlank()) {
            flush()
            i++
            continue
        }
        val heading = HEADING.find(line)
        when {
            heading != null -> {
                flush()
                blocks.add(MdBlock.Heading(heading.groupValues[1].length, heading.groupValues[2].trim().trimEnd('#').trim()))
                i++
            }
            RULE.matches(line) -> {
                flush()
                blocks.add(MdBlock.Rule)
                i++
            }
            line.contains('|') && i + 1 < lines.size && TABLE_DIVIDER.matches(lines[i + 1]) -> {
                flush()
                val rows = mutableListOf(tableCells(line))
                i += 2
                while (i < lines.size && lines[i].contains('|') && lines[i].isNotBlank()) {
                    rows.add(tableCells(lines[i]))
                    i++
                }
                blocks.add(MdBlock.Table(rows))
            }
            line.trimStart().startsWith(">") -> {
                flush()
                val quote = StringBuilder()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    if (quote.isNotEmpty()) quote.append('\n')
                    quote.append(lines[i].trimStart().removePrefix(">").trimStart())
                    i++
                }
                blocks.add(MdBlock.Quote(quote.toString()))
            }
            BULLET.matches(line) -> {
                flush()
                val match = BULLET.find(line)!!
                blocks.add(MdBlock.ListItem("•", match.groupValues[1].length / 2, match.groupValues[2]))
                i++
            }
            ORDERED.matches(line) -> {
                flush()
                val match = ORDERED.find(line)!!
                blocks.add(MdBlock.ListItem("${match.groupValues[2]}.", match.groupValues[1].length / 2, match.groupValues[3]))
                i++
            }
            else -> {
                val last = blocks.lastOrNull()
                if (paragraph.isEmpty() && last is MdBlock.ListItem && line.startsWith("  ")) {
                    blocks[blocks.lastIndex] = last.copy(text = last.text + " " + line.trim())
                } else {
                    if (paragraph.isNotEmpty()) paragraph.append('\n')
                    paragraph.append(line)
                }
                i++
            }
        }
    }
    flush()
    return blocks
}

data class MdStyle(val code: SpanStyle, val link: SpanStyle)

private val INLINE = Regex(
    "(`+)(.+?)\\1" +
        "|\\*\\*(.+?)\\*\\*" +
        "|__(.+?)__" +
        "|~~(.+?)~~" +
        "|(?<![\\w*])\\*(?!\\s)(.+?)(?<!\\s)\\*(?![\\w*])" +
        "|(?<![\\w_])_(?!\\s)(.+?)(?<!\\s)_(?![\\w_])" +
        "|\\[([^\\]]+)]\\(([^)\\s]+)\\)" +
        "|(https?://[^\\s<>\"')\\]]+)",
)

fun inlineMarkdown(text: String, style: MdStyle, onLink: (String) -> Unit = {}): AnnotatedString =
    buildAnnotatedString { appendInline(text, style, 0, onLink) }

private fun AnnotatedString.Builder.appendInline(text: String, style: MdStyle, depth: Int, onLink: (String) -> Unit) {
    var index = 0
    for (match in INLINE.findAll(text)) {
        if (match.range.first > index) append(text.substring(index, match.range.first))
        val g = match.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(style.code) { append(g[2]) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { nested(g[3], style, depth, onLink) }
            g[4].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { nested(g[4], style, depth, onLink) }
            g[5].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { nested(g[5], style, depth, onLink) }
            g[6].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { nested(g[6], style, depth, onLink) }
            g[7].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { nested(g[7], style, depth, onLink) }
            g[9].isNotEmpty() -> withLink(
                LinkAnnotation.Clickable(g[9], TextLinkStyles(style.link)) { onLink(g[9]) },
            ) { nested(g[8], style, depth, onLink) }
            g[10].isNotEmpty() -> {
                val url = g[10].trimEnd('.', ',', ';', ':', '!', '?')
                withLink(LinkAnnotation.Url(url, TextLinkStyles(style.link))) { append(url) }
                append(g[10].substring(url.length))
            }
        }
        index = match.range.last + 1
    }
    if (index < text.length) append(text.substring(index))
}

private fun AnnotatedString.Builder.nested(text: String, style: MdStyle, depth: Int, onLink: (String) -> Unit) {
    if (depth >= 3) append(text) else appendInline(text, style, depth + 1, onLink)
}

@Composable
fun rememberMdStyle(): MdStyle {
    val scheme = MaterialTheme.colorScheme
    return remember(scheme) {
        MdStyle(
            code = SpanStyle(fontFamily = FontFamily.Monospace, background = scheme.surfaceContainerHigh),
            link = SpanStyle(color = scheme.onSurface, textDecoration = TextDecoration.Underline),
        )
    }
}

@Composable
fun Markdown(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    selectable: Boolean = true,
) {
    val blocks = remember(text) { parseMarkdown(text) }
    val style = rememberMdStyle()
    val onLink = rememberMdLinkHandler()
    val body = MaterialTheme.typography.bodyLarge.copy(color = color)
    val content = @Composable {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            for (block in blocks) MarkdownBlock(block, style, body, onLink)
        }
    }
    if (selectable) SelectionContainer { content() } else content()
}

/** Opens inline Markdown links: same-server paths go to the matching screen in-app, everything else to the browser. */
private fun openMdLink(container: AppContainer, context: Context, link: String) {
    val serverUrl = container.session.serverUrl
    val url = if (link.startsWith("/") && serverUrl != null) serverUrl + link else link
    val inApp = groot.mobile.data.parseAppLink(url, serverUrl)
    if (inApp != null) {
        container.links.open(inApp)
    } else {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: ActivityNotFoundException) {
        }
    }
}

@Composable
private fun rememberMdLinkHandler(): (String) -> Unit {
    val container = LocalContainer.current
    val context = LocalContext.current
    return remember(container, context) { { link: String -> openMdLink(container, context, link) } }
}

@Composable
private fun MarkdownBlock(block: MdBlock, style: MdStyle, body: TextStyle, onLink: (String) -> Unit) {
    when (block) {
        is MdBlock.Heading -> Text(
            inlineMarkdown(block.text, style, onLink),
            style = when (block.level) {
                1 -> MaterialTheme.typography.titleLarge
                2 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            }.copy(color = body.color),
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = S.xs),
        )
        is MdBlock.Paragraph -> Text(inlineMarkdown(block.text, style, onLink), style = body)
        is MdBlock.ListItem -> Row(Modifier.padding(start = S.md * block.depth)) {
            Text(block.marker, style = body, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(S.xl))
            Text(inlineMarkdown(block.text, style, onLink), style = body, modifier = Modifier.weight(1f))
        }
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(Dims.stroke).fillMaxHeight().background(MaterialTheme.colorScheme.outline))
            Text(
                inlineMarkdown(block.text, style, onLink),
                style = body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = S.md),
            )
        }
        is MdBlock.Code -> Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .background(MaterialTheme.colorScheme.surfaceContainer),
        ) {
            if (block.language.isNotEmpty()) {
                Text(
                    block.language,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = S.md, top = S.sm),
                )
            }
            Text(
                block.code,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, color = body.color),
                softWrap = false,
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(S.md),
            )
        }
        is MdBlock.Table -> Column(
            Modifier
                .horizontalScroll(rememberScrollState())
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(S.sm),
        ) {
            val columns = block.rows.maxOfOrNull { it.size } ?: 0
            block.rows.forEachIndexed { index, row ->
                Row(horizontalArrangement = Arrangement.spacedBy(S.lg), modifier = Modifier.padding(vertical = S.xs)) {
                    for (column in 0 until columns) {
                        Text(
                            inlineMarkdown(row.getOrElse(column) { "" }, style, onLink),
                            style = MaterialTheme.typography.bodyMedium.copy(color = body.color),
                            fontWeight = if (index == 0) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.width(Dims.thumbnail * 2),
                        )
                    }
                }
            }
        }
        MdBlock.Rule -> Box(Modifier.fillMaxWidth().height(Dims.hairline).background(MaterialTheme.colorScheme.outlineVariant))
    }
}
