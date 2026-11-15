package groot.mobile.data.chat

/**
 * Port of the web client's `lib/attachment-notes.ts`. The server annotates a send that carries
 * attachments for the model (reference lines, inline file text fenced as
 * `<attachment … untrusted>`, outlines and tool hints). The owner's bubble shows what they
 * typed; the chips show the files.
 */
private val FENCE = Regex("<attachment id=\"[^\"]*\" name=\"[^\"]*\" untrusted>\\n[\\s\\S]*?\\n</attachment>")
private val NOTE_LINES = listOf(
    Regex("^\\[(?:file|image) attached: .*\\]$"),
    Regex("^ {2}Outline: "),
    Regex("^\\(Read or search files with read_attachment "),
    Regex("^\\(The owner attached image\\(s\\); call see_image "),
)

/** What the owner wrote, without the server's notes for the model; text with no attachments is left as it is. */
fun ownerText(text: String, hasAttachments: Boolean): String {
    if (!hasAttachments) return text
    return text
        .replace(FENCE, "")
        .split("\n")
        .filterNot { line -> NOTE_LINES.any { it.containsMatchIn(line) } }
        .joinToString("\n")
        .trim()
}
