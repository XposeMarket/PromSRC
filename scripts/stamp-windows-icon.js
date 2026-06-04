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

  console.log(`[stamp-windows-icon] Stamped ${path.basename(iconPath)} into ${exePath}`);
};
