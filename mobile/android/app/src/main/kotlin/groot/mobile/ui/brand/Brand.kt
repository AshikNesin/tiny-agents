package groot.mobile.ui.brand

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import groot.kit.tokens.GrootColors
import groot.kit.tokens.GrootPalette

val BrandPalette: GrootPalette = GrootPalette(
    light = GrootColors.Light,
    dark = GrootColors.Dark,
)

object Accents {
    val success = Color(0xFF30D158)
    val warning = Color(0xFFFFB340)
}

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

    val tile = 48.dp

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

    val sheetRadius = 28.dp
    val shareCard = 104.dp
    val shareChipMaxWidth = 180.dp

    val drawerWidth = 320.dp
    val contentMaxWidth = 720.dp
    val sheetHandleWidth = 36.dp

    val pipMaxWidth = 240.dp
    val pipMaxStreamHeight = 160.dp
    val pipElevation = 8.dp

    val keyMinWidth = 44.dp
    val keyHeight = 38.dp

    val progress = 20.dp
    val logo = 56.dp
}
