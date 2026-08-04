import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const rootDir = process.cwd();
const sourceSvg = path.join(rootDir, 'src', 'assets', 'app-logo.svg');
const buildDir = path.join(rootDir, 'build');
const iconSvgPath = path.join(buildDir, 'icon.svg');
const iconPngPath = path.join(buildDir, 'icon.png');
const iconIcoPath = path.join(buildDir, 'icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

async function ensureSource() {
  await fs.access(sourceSvg);
}

async function generate() {
  await ensureSource();
  await fs.mkdir(buildDir, { recursive: true });

  const svgBuffer = await fs.readFile(sourceSvg);
  await fs.writeFile(iconSvgPath, svgBuffer);

  await sharp(svgBuffer).resize(1024, 1024).png().toFile(iconPngPath);

  const icoPngBuffers = await Promise.all(
    sizes.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
  );
  const icoBuffer = await pngToIco(icoPngBuffers);
  await fs.writeFile(iconIcoPath, icoBuffer);

  console.log(`Generated ${path.relative(rootDir, iconPngPath)} and ${path.relative(rootDir, iconIcoPath)}`);
}

generate().catch((error) => {
  console.error('Failed to generate app icons:', error);
  process.exitCode = 1;
});
