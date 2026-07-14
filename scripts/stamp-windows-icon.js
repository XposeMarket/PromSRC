const fs = require('fs');
const path = require('path');
const rcedit = require('rcedit');

module.exports = async function stampWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productFilename = context.packager.appInfo.productFilename || 'Prometheus';
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'assets', 'Prometheus.ico');
  const version = context.packager.appInfo.version;

  if (!fs.existsSync(exePath)) {
    throw new Error(`[stamp-windows-icon] Missing packaged exe: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`[stamp-windows-icon] Missing icon file: ${iconPath}`);
  }

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': version,
    'product-version': version,
    'version-string': {
      CompanyName: 'Prometheus',
      FileDescription: 'Prometheus Desktop',
      InternalName: 'Prometheus',
      OriginalFilename: `${productFilename}.exe`,
      ProductName: 'Prometheus',
    },
  });

  // The public build excludes bin/** from app.asar. If the native desktop
  // helper was built for this release, stage it beside app.asar so the runtime
  // can discover one stable executable identity for Windows.Graphics.Capture.
  const desktopHelperSource = path.join(context.packager.projectDir, 'bin', 'prometheus-desktop-helper.exe');
  if (fs.existsSync(desktopHelperSource)) {
    const desktopHelperDestination = path.join(context.appOutDir, 'resources', 'prometheus-desktop-helper.exe');
    fs.copyFileSync(desktopHelperSource, desktopHelperDestination);
    console.log(`[stamp-windows-icon] Staged ${path.basename(desktopHelperSource)} in resources`);
  } else {
    console.warn('[stamp-windows-icon] Native desktop helper not built; packaged app will use CopyFromScreen fallback.');
  }

  console.log(`[stamp-windows-icon] Stamped ${path.basename(iconPath)} into ${exePath}`);
};
