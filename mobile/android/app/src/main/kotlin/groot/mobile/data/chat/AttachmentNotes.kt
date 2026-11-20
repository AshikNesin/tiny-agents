package groot.mobile.data.chat

private val FENCE = Regex("<attachment id=\"[^\"]*\" name=\"[^\"]*\" untrusted>\\n[\\s\\S]*?\\n</attachment>")
private val NOTE_LINES = listOf(
    Regex("^\\[(?:file|image) attached: .*\\]$"),
    Regex("^ {2}Outline: "),
    Regex("^\\(Read or search files with read_attachment "),
    Regex("^\\(The owner attached image\\(s\\); call see_image "),
)

fun ownerText(text: String, hasAttachments: Boolean): String {
    if (!hasAttachments) return text
    return text
        .replace(FENCE, "")
        .split("\n")
        .filterNot { line -> NOTE_LINES.any { it.containsMatchIn(line) } }
        .joinToString("\n")
        .trim()
}
