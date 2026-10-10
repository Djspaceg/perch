/**
 * The app icon: the songbird on a sensor trace, on a graphite tile ("Signal"). Committed as two
 * files under `apps/desktop/icons/`:
 *
 * ```text
 * app-icon.svg   the master, on Apple's grid: a 1024 canvas, an 824 tile with continuous corners
 * app-icon.png   the master rendered at 1024, RGBA
 * ```
 *
 * electron-builder makes the .icns, the .ico and the Linux sizes from the PNG, which the packaging
 * config names (`packaging.ts`). The PNG is committed rather than rendered here because the
 * master's gradients, glow and shadows need a browser's renderer. After editing the SVG, render it
 * again with headless Chrome, at 1024 on a clear background (it may not exit once it has written
 * the file):
 *
 * ```sh
 * chrome --headless=new --force-device-scale-factor=1 --default-background-color=00000000 \
 *   --window-size=1024,1024 --screenshot=app-icon.png app-icon.svg
 * ```
 *
 * The tray icon is not this: it is a template silhouette of the same bird, `tray-icon.ts`.
 */

/** The SVG master, relative to apps/desktop. */
export const APP_ICON_MASTER = 'icons/app-icon.svg';
/** Its 1024 PNG, relative to apps/desktop. */
export const APP_ICON_PNG = 'icons/app-icon.png';
