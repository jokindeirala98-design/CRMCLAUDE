/**
 * Renderiza HTML a PDF usando puppeteer-core + chromium-min.
 *
 * Funciona en:
 *  - Local (Mac/Linux): usa chromium del sistema o el descargado por puppeteer-core.
 *  - Vercel/AWS Lambda: usa @sparticuz/chromium-min (binario optimizado serverless).
 */
import puppeteer from 'puppeteer-core'

const REMOTE_CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

async function getBrowser() {
  // Detectar entorno: en Vercel/Lambda usar chromium-min
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium-min')).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(REMOTE_CHROMIUM_URL),
      headless: true,
    })
  }
  // Local: intentar usar chromium del sistema
  const localChrome = process.env.CHROMIUM_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return puppeteer.launch({
    executablePath: localChrome,
    headless: true,
  })
}

export interface HtmlToPdfOptions {
  /** Orientación de la página. Default: portrait. */
  landscape?: boolean
  /** Formato de página. Default: A4. */
  format?: 'A4' | 'A3' | 'Letter' | 'Legal'
  /** Márgenes en CSS units (ej. '8mm' o '0'). Default: 0 (los gestiona el CSS). */
  margin?: { top?: string; right?: string; bottom?: string; left?: string }
}

export async function htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: options.margin ?? { top: '0', right: '0', bottom: '0', left: '0' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
