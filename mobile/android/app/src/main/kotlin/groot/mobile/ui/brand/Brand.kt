package groot.mobile.ui.brand

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import groot.kit.tokens.GrootColors
import groot.kit.tokens.GrootPalette

/**
 * Your brand. This folder is the one place in app code where color literals and raw dp
 * values are allowed (`check:tokens`). Tiny Agents keeps the kit's palette as it is: a
 * true-black page, white as the only accent, grey secondary text.
 */
val BrandPalette: GrootPalette = GrootPalette(
    light = GrootColors.Light,
    dark = GrootColors.Dark,
)

/** Status colors the kit has no token for: a live dot, a warning dot. */
object Accents {
    val success = Color(0xFF30D158)
    val warning = Color(0xFFFFB340)
}

/** The app's own sizes, beside the kit's spacing scale (`S`). */
object Dims {
    val avatarSmall = 28.dp
    val avatarTopBar = 32.dp
    val avatar = 40.dp
    val avatarSheet = 48.dp
    val avatarLarge = 72.dp

    val iconSmall = 16.dp
    val icon = 20.dp
    val iconLarge = 24.dp
    val iconButton = 40.dp

    /** The icon square of a launcher tile (drawer workspace, bot menu). */
    val tile = 48.dp

    /** Chat bubbles and the composer pill. */
    val bubbleRadius = 22.dp
    val bubbleMaxWidth = 330.dp
    val composerRadius = 28.dp
    val composerMinHeight = 56.dp
    val sendButton = 36.dp
    val thumbnail = 72.dp
    val imagePreviewMax = 240.dp

    val cardRadius = 18.dp
    val fieldRadius = 14.dp
    val chipRadius = 100.dp
    val dot = 8.dp
    val hairline = 1.dp
    val stroke = 2.dp

    val drawerWidth = 320.dp
    val contentMaxWidth = 720.dp
    val sheetHandleWidth = 36.dp

    /** The terminal's and live view's key bar. */
    val keyMinWidth = 44.dp
    val keyHeight = 38.dp

    val progress = 20.dp
    val logo = 56.dp
}
