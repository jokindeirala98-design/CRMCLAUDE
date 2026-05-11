/**
 * voltis-contract-templates.ts
 * Genera HTML completo (idéntico al diseño original) para la propuesta (PRC, 4 pp.)
 * y el contrato de prestación de servicios (CSP, 6 pp.).
 *
 * Uso:
 *   const html = generatePropuestaHTML({ client, contract, feeAmount, endDate })
 *   const w = window.open('', '_blank')
 *   w!.document.write(html)
 *   w!.document.close()
 *   // El usuario pulsa Ctrl+P en la nueva ventana
 */

/**
 * Returns "NIE" if the identifier is a Spanish foreigner's ID (X/Y/Z + 7 digits + letter),
 * "DNI" otherwise. Used to produce the correct legal wording in contracts.
 */
function idDocLabel(nif: string | null | undefined): 'NIE' | 'DNI' {
  if (!nif) return 'DNI'
  const clean = nif.trim().toUpperCase().replace(/[-\s]/g, '')
  return /^[XYZ]\d{7}[A-Z]$/.test(clean) ? 'NIE' : 'DNI'
}

const BASE_CSS = `
:root{
  --paper:#fbfaf7;--ink:#1a1d1a;--ink-2:#3a3d3a;--ink-3:#6b6f6b;--ink-4:#a8aaa6;
  --rule:#d9d8d2;--rule-soft:#e8e7e1;
  --accent:oklch(0.50 0.10 235);--accent-soft:oklch(0.95 0.025 230);--accent-ink:oklch(0.34 0.09 235);
  --serif:'Fraunces',Georgia,serif;--sans:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e7e5df;color:var(--ink);font-family:var(--sans);font-size:12pt;line-height:1.55;-webkit-font-smoothing:antialiased}
.viewer{display:flex;flex-direction:column;align-items:center;gap:18px;padding:36px 16px 80px;min-height:100vh}
.page{width:210mm;min-height:297mm;background:var(--paper);box-shadow:0 1px 0 rgba(0,0,0,.04),0 24px 60px -28px rgba(20,25,20,.25),0 8px 16px -8px rgba(20,25,20,.10);position:relative;padding:18mm 20mm 16mm;display:flex;flex-direction:column;color:var(--ink);overflow:visible}
.page-body{flex:1;display:flex;flex-direction:column}
.runhead{display:flex;align-items:center;justify-content:space-between;font-size:9pt;color:var(--ink-3);letter-spacing:.04em;padding-bottom:4mm;border-bottom:.5pt solid var(--rule-soft);margin-bottom:7mm}
.runhead .left{display:flex;align-items:center;gap:10px}
.brand{display:inline-flex;align-items:center;gap:8px;font-family:var(--serif);font-weight:500;font-size:11pt;color:var(--ink);letter-spacing:-.005em}
.brand-mark{width:18px;height:18px;border-radius:4px;background:var(--accent);position:relative;display:inline-block}
.brand-mark::before{content:"";position:absolute;inset:4px;background:var(--paper);clip-path:polygon(58% 0,0 58%,42% 58%,30% 100%,100% 38%,58% 38%)}
.runhead .right{color:var(--ink-3)}
.runfoot{margin-top:auto;padding-top:6mm;border-top:.5pt solid var(--rule-soft);display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:end;font-size:8.5pt;color:var(--ink-3)}
.runfoot .legal{line-height:1.5}.runfoot .legal b{color:var(--ink-2);font-weight:600}
.runfoot .pageno{font-family:var(--mono);font-size:9pt;color:var(--ink-2);white-space:nowrap}
.runfoot .pageno em{color:var(--ink-4);font-style:normal}
.runfoot .contact{text-align:right;line-height:1.5}
.cover{display:flex;flex-direction:column;gap:0;flex:1}
.cover-eyebrow{font-family:var(--mono);font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink);display:inline-flex;align-items:center;gap:10px;margin-bottom:14mm}
.cover-eyebrow::before{content:"";width:22px;height:1px;background:var(--accent)}
.cover h1{font-family:var(--serif);font-weight:400;font-size:42pt;line-height:1.04;letter-spacing:-.02em;color:var(--ink);text-wrap:balance}
.cover h1 em{font-style:italic;color:var(--accent-ink);font-weight:400}
.cover-sub{margin-top:10mm;font-size:11.5pt;line-height:1.5;color:var(--ink-2);max-width:135mm;text-wrap:pretty}
.cover-rule{height:.5pt;background:var(--rule);margin:18mm 0 12mm}
.section-title{font-family:var(--mono);font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6mm;display:flex;align-items:center;gap:10px}
.section-title::after{content:"";flex:1;height:.5pt;background:var(--rule-soft)}
.party-grid{display:grid;grid-template-columns:1fr;gap:8mm}
.party{display:grid;grid-template-columns:34mm 1fr;gap:8mm;padding:6mm 0;border-top:.5pt solid var(--rule-soft);break-inside:avoid;page-break-inside:avoid}
.party:last-child{border-bottom:.5pt solid var(--rule-soft)}
.party-tag{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);padding-top:3px}
.party-tag .role{color:var(--accent-ink);display:block;margin-top:2px;font-weight:500}
.party-body{font-size:11pt;line-height:1.65;color:var(--ink-2)}
.party-body strong{color:var(--ink);font-weight:600}
.party-body .alias{color:var(--ink-3);font-style:italic}
.cover-meta{margin-top:14mm;display:grid;grid-template-columns:1fr 1fr;gap:8mm;padding-top:8mm;border-top:.5pt solid var(--rule-soft)}
.cover-meta .field{display:flex;flex-direction:column;gap:4px}
.cover-meta .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.cover-meta .value{font-family:var(--serif);font-size:14pt;color:var(--ink);border-bottom:.5pt solid var(--ink-4);padding-bottom:3mm}
.expone-list{display:flex;flex-direction:column;gap:5mm;margin-bottom:10mm}
.expone-item{display:grid;grid-template-columns:18mm 1fr;gap:6mm;font-size:11pt;line-height:1.6;color:var(--ink-2);break-inside:avoid;page-break-inside:avoid}
.expone-item .ord{font-family:var(--serif);font-style:italic;font-size:11pt;color:var(--accent-ink);font-weight:500}
.bridge{font-size:11pt;line-height:1.65;color:var(--ink-2);padding:6mm 0;border-top:.5pt solid var(--rule-soft);border-bottom:.5pt solid var(--rule-soft);margin:4mm 0 12mm}
.clauses{display:flex;flex-direction:column;gap:6mm}
.clause{display:grid;grid-template-columns:34mm 1fr;gap:8mm;page-break-inside:avoid;break-inside:avoid}
.clause-num{display:flex;flex-direction:column;gap:2px;border-right:.5pt solid var(--rule-soft);padding-right:6mm}
.clause-num .kicker{font-family:var(--mono);font-size:8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-4)}
.clause-num .ord{font-family:var(--serif);font-weight:300;font-size:26pt;line-height:1;letter-spacing:-.02em;color:var(--ink)}
.clause-num .ord em{font-style:italic;color:var(--accent-ink);font-weight:400}
.clause-body h2{font-family:var(--serif);font-weight:400;font-size:14pt;line-height:1.2;letter-spacing:-.005em;color:var(--ink);margin-bottom:4mm}
.clause-body p{font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-bottom:2.5mm;text-wrap:pretty}
.clause-body p:last-child{margin-bottom:0}
.clause-body strong{color:var(--ink);font-weight:600}
.clause-body em{color:var(--accent-ink);font-style:italic}
.blank{display:inline-block;min-width:24mm;border-bottom:.5pt solid var(--ink-4);padding:0 3px;color:var(--ink);text-align:center}
.blank.short{min-width:14mm}.blank.long{min-width:50mm}.blank.amt{min-width:24mm}
.cb-list{list-style:none;display:flex;flex-direction:column;gap:2.5mm;margin:2mm 0 0;padding:0}
.cb-list>li{display:flex;align-items:flex-start;gap:9px;font-size:10.5pt;line-height:1.5;color:var(--ink-2)}
.cb-list>li::before{content:"";flex:0 0 5px;width:5px;height:5px;border-radius:1px;background:var(--accent);margin-top:8px}
.cb-list>li>.li-body{flex:1;min-width:0}
.cb-sub{list-style:none;margin:2mm 0 0;padding:0;display:flex;flex-direction:column;gap:1.5mm}
.cb-sub>li{display:flex;align-items:flex-start;gap:7px;font-size:10.5pt;line-height:1.5;color:var(--ink-3)}
.cb-sub>li::before{content:"›";flex:0 0 auto;color:var(--ink-4);font-family:var(--serif);line-height:1.4}
.cb-sub>li>.li-body{flex:1;min-width:0}
.fees{margin:2mm 0 4mm;background:var(--accent-soft);border-radius:6px;padding:5mm 7mm;display:grid;grid-template-columns:1fr auto;gap:6mm;align-items:center;border:.5pt solid color-mix(in oklch,var(--accent) 20%,transparent);break-inside:avoid;page-break-inside:avoid}
.fees .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm}
.fees .desc{font-size:10.5pt;color:var(--ink-2);line-height:1.5}
.fees .figure{font-family:var(--serif);font-weight:300;font-size:28pt;line-height:1;color:var(--ink);white-space:nowrap}
.fees .figure .pct{font-size:18pt;color:var(--ink-3);margin-left:2mm;font-style:normal}
.oblig-grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:2mm;break-inside:avoid;page-break-inside:avoid}
.oblig-col h3{font-family:var(--mono);font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:4mm;padding-bottom:2.5mm;border-bottom:.5pt solid var(--rule-soft)}
.pay-row{display:grid;grid-template-columns:1fr;gap:3mm;border:.5pt solid var(--rule);border-radius:5px;padding:4mm 5mm;margin:2mm 0 3mm;break-inside:avoid;page-break-inside:avoid}
.pay-row .top{display:grid;grid-template-columns:1fr auto;gap:4mm;align-items:baseline}
.pay-row .top .amt{font-family:var(--serif);font-size:18pt;font-weight:400;color:var(--ink);white-space:nowrap}
.pay-row .top .amt .vat{font-size:10pt;color:var(--ink-3);font-family:var(--sans);font-weight:400}
.pay-row .top .desc{font-size:10.5pt;color:var(--ink-2);line-height:1.5}
.iban{font-family:var(--mono);font-size:10pt;color:var(--ink);background:#f1efe9;padding:2mm 3mm;border-radius:3px;display:inline-block;letter-spacing:.04em}
.callout{margin-top:3mm;padding:4mm 5mm;border-left:1.5pt solid var(--accent);background:#f5f3ec;border-radius:0 4px 4px 0;break-inside:avoid;page-break-inside:avoid}
.callout .label{font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:3mm}
.callout .row{display:grid;grid-template-columns:18mm 1fr;gap:5mm;font-size:10.5pt;line-height:1.55;color:var(--ink-2);margin-bottom:2mm}
.callout .row:last-child{margin-bottom:0}
.callout .row .tag{font-family:var(--mono);font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding-top:2pt}
.callout .row .tag.up{color:oklch(0.48 0.16 145)}.callout .row .tag.down{color:oklch(0.50 0.13 30)}
.signing-intro{text-align:center;font-family:var(--serif);font-style:italic;font-size:13pt;color:var(--ink-2);margin:6mm 0 3mm}
.signing-sub{text-align:center;font-size:10pt;color:var(--ink-3);max-width:130mm;margin:0 auto 8mm;line-height:1.45}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-top:2mm;break-inside:avoid;page-break-inside:avoid}
.sig{display:flex;flex-direction:column}
.sig .role{font-family:var(--mono);font-size:8.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:3mm}
.sig .box{height:30mm;border:.5pt dashed var(--ink-4);border-radius:4px;background:repeating-linear-gradient(45deg,transparent 0 8px,rgba(0,0,0,.015) 8px 16px);margin-bottom:3mm;display:flex;align-items:flex-end;padding:3mm 4mm;font-family:var(--mono);font-size:7.5pt;color:var(--ink-4);letter-spacing:.1em;text-transform:uppercase}
.sig .name{font-family:var(--serif);font-size:13pt;color:var(--ink);font-weight:500}
.sig .id{font-size:9.5pt;color:var(--ink-3);margin-top:1mm}
.anchor{font-family:var(--mono);font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)}
@media print{
  html,body{background:#fff!important;margin:0!important;padding:0!important}
  .viewer{
    display:block!important;
    padding:0!important;
    gap:0!important;
    background:#fff!important;
    min-height:0!important;
  }
  .page{
    box-shadow:none!important;
    width:210mm!important;
    height:auto!important;
    min-height:0!important;
    max-height:none!important;
    overflow:visible!important;
    break-before:page;
    page-break-before:always;
    margin:0!important;
    padding:18mm 20mm 16mm!important;
  }
  .page:first-child{
    break-before:auto!important;
    page-break-before:auto!important;
  }
  .page-body{overflow:visible!important;height:auto!important}
  @page{size:A4;margin:0}
}
`

const GOOGLE_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />`
const FIRMA_NICOLAS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA04AAAHGCAYAAABD3NsdAAABWGlDQ1BJQ0MgUHJvZmlsZQAAeJx9kLFLw1AQxr9WpaB1EB0cHDKJQ5SSCro4tBVEcQhVweqUvqapkMZHkiIFN/+Bgv+BCs5uFoc6OjgIopPo5uSk4KLleS+JpCJ6j+N+fO+74zggOW5wbvcDqDu+W1zKK5ulLSX1jAS9IAzm8Zyur0r+rj/j/T703k7LWb///43Biukxqp+UGcZdH0ioxPqezyXvE4+5tBRxS7IV8onkcsjngWe9WCC+JlZYzagQvxCr5R7d6uG63WDRDnL7tOlsrMk5lBNYxA48cNgw0IQCHdk//LOBv4BdcjfhUp+FGnzqyZEiJ5jEy3DAMAOVWEOGUpN3ju53F91PjbWDJ2ChI4S4iLWVDnA2Rydrx9rUPDAyBFy1ueEagdRHmaxWgddTYLgEjN5Qz7ZXzWrh9uk8MPAoxNskkDoEui0hPo6E6B5T8wNw6XwBA6diE8HYWhMAAHULSURBVHic7d15vCNXeef/b5Wk2/vq7jZu7zbesLENxmlgfgQSkkD2wEyYrIQlCQnZSSbJZEImZF9IeJEJIZlsQBKyA0MWCCSQhITFGIy3thsb73bbbne7u93LvVdSnd8fpUd6dFRSSXeVrj7v1+u+rq6kKlWVSrrnqeec5yQhBAEAAAAA+ktXewMAAAAAYNwROAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBLV1d4AAKun2WyqUqmo0WioWq0qyzKladr+PTs7qw0bNnyxpC+VVJN0WtLHsiz7tyRJVnfjAQAAVlASQljtbQCwiixIsuDJ7qtUKi+V9JuSrpCUqZOhPi3puxuNxp9WKpVV2WYAAICVRuAETLkQgix7lGWZQgiqVqtfK+lvJM1ICpKS1m+1bh8IIVy+GtsLAACwGhjjBEy5LMsk5QFUmqZK01SSfk550JQpD5Qa7rYkXbx///6V31gAAIBVQsYJmGLWTc+yTs1mU8ePH9fOnTsze4qkfv3xfiCE8NsrtKkAAACriowTMMV80CRJlUpFd911l9TJLFUkNZUHUHK/JemildpOAACA1UbgBEw566rXbDYlSfv27Xu5pDl1gqeg/Lui3vodlAdT567wpgIAAKwaypEDU84q47XGNknSNknr1CkGUW3drvnFJJ29MlsIAACw+sg4AVOszxjHnepU0kvcbbnbdbW66jFOEgAATAMCJwCSJDehrc9Ex1GR/V2TtC3LMsUT4VogRUAFAADWEgInYIr1CXrWqZNhUnTbWz83N7c8GwYAADBmCJwAxNa3fvsueiZ1j+nkyZP5Hy67ZMFYHJQBAABMMgInAHH3uvUFT8nU221PTz311LJuFwAAwLggcALQ1soSWfU8nzJK1V0gQlIncPLZJcY2AQCAtYjACUBs0DQFQa4L3zXXXPNf2g+0AiYLogigAADAWkLgBKCtFfRYCXLju+kl6nxvZJLW9wuQGOMEAADWEgInYIrFWaKWWvQ0300vvn+nLwZBKXIAALBWETgBU6xPVmiUVNGgbn0AAABrBoETgDaXKRo2eJopKkUOAACw1hA4AYiNEv3E3foAAADWJAInALGRAqeiLBOZJwAAsNYQOAFYjJn4DgpDAACAtYjACcBizGRZ1nUH2SYAALAWETgBU64gQ2SRzzCpo2q/DBOZJwAAsJYQOAFTriBDZCmkYVJHGyqVSjtI8tknMk8AAGAtIXACsBgVqRMkESwBAIC1isAJQCxouG56UmsCXLrlAQCAtY7ACcBizIQQyDgBAIA1j8AJQNsCAh8mwAUAAFOBwAlAbJR+dwROAABgKhA4AViMSnwH450AAMBaROAEYDFSxjUBAIBpQOAETDHLDkW/6xpuDiep1VXPZ5kIpAAAwFpE4ARgMYiSAADAVCBwAhDLRnhuzxgniXFOAABg7SFwAhAbJeqpSHTPAwAAax+BEzDF4olrW79HyjiRXQIAANOAwAlALNPwWafCrnoAAABrDYETMOUKMkYjd9UDAABY6wicAEjqCqBGCZwSuuoBAIBpQOAETLEQgpIkUZZl7d+S5jV8mfH1aZp2zQNl6wQAAFhLCJwALAYREgAAmAoETgBio1TV4zsEAABMhepqbwCA1ReVI19wcQi66AEAgLWKq8XAFOsT6Iw0j9OA9QAAAKwZBE4A2twEuMNmnfgOAQAAU4FGD4A4Y8Q8TgAAABECJwAx5nECAACIEDhhqrXmLepicxFJUr1eL3z+WgkW/H642/XCJxerJknSbz0AAABrBoETppqfvDXLsvZtCwZqtZrm5+fbz4+qz60pbp9GyjhFywIAAKxJBE6YekmSaH5+XkmStH/sfkmamZlpB1VJkrSzTs1mc9W2eZmNNI8TGSYAADANCJww9ZrNpmZmZrqCIgsGLDhK07SdhUrT/GNTqazZughMgAsAABCh0YOp5wOgNE3VaDTa2aZKpdIe59RsNtv3F42NmkR9utiNkkprHzzfzREAAGCtIXDCVLOMkh/nVK1WFUJQlmU6cOCAZmZmXpIkydfcdtttkqRGo9HOOq1RCwqcAAAA1rI13foDylQqlXaGKcsyJUmikydPKk3TH61UKvdefvnlTUkflPS+a6+9NiRJ8lCtVvtfx48fX1PV46J9WXRXvbV0bAAAACQCJ0DValVS3k1v//792rx5822S3izpfOWfkaA8s5JJOlvSL2zbtu2WO+64Y5W2eNkxjxMAAECEwAlTzcYvNRoN3X777brqqqsOS7pSefBgg3UsMvCfl8uuvPLKRx955JH28saXNR93flySG7fVUGffy9SspLuNbfK3AQAA1goCJ0y1Wq2mRqOh06dP66qrrtovaac6QVNTvdkXiy5mJG0/++yz//n06dOqVqvKskzNZlNpmk5k8YjFzOMEAACw1hE4YaqFEFStVrV169aflXSF8sDIgiYrfNDvc7JO0os3btz4VisYYRX6Jrx4xMhjnHyGiWwTAABYiya6dQcshZMnT0rSD7f+TNzvpnozKvaZ8VmZ19dqtRf4J01ixsmhqh4AAECEwAlTLUkSbd68+RskbWvdZRFPqu6gIO6+FtxPVdJvZlnW7q5XqVTapc7HWZ9M0aLmcQIAAFiLCJwA6TnKAybrnmcBkdxvn3kKyj87/r7nVCqV7/Xd9fzEuuNuqcuRAwAArDU0ejDVWlmhvcqDIIt0rDiEr6wn95jnH//ZI0eOdE2mO6EInAAAACI0ejDVWlmhs9UZ02SKypEbu98HGE1Je84444zfttLeE1wggnmcAAAAIhPbsgOWQqvRv6f1p3XTiz8XSZ/b9rw5t+x3Pvzww7K5jfz8TiGEdhYqhDBWY4KSJPHb0xj03EjNxkb58VLjtG8AAABLgcAJkDYuYtlMeVlyy1CtO+ecc94i5YFEtVpVo9FoTwrrs1BjXLabeZwAAAAiBE6Yaq3gZVvRQ0OuIlUnaMpaP685ePBgO6uUpmk7SLL7xjhokkYb4zTWOwIAALBUCJww1VpdyrYucjU2Pipt/Wzdu3fvLydJ0s4yZVnWDpjGtWhEVI582KxTSrc8AAAwDQicMNXq9bokrVd3oDBKJFD03CDpdY8//nh7jJPPOlmZ8jEOOEaax2mM9wMAAGDJEDhhqs3Ozkrd1fNG7XpmXfQqyosqWBSx48wzz3xTtVrterJNiptl2Th31xslcCLjBAAApgKBE6bayZMn7eZiohhbtqLuIOz7n3zySUlqZ54s2zSu3fVaFjzGyYKoMQ4KAQAAFoTACVNtbm6u6O5+8zf1Y8+zsU5J62fnzp07X9doNGSZJwuYqtVqO/s0hkZKIZFxAgAA04DACVPtxIkTUnnXtMz9LooS/OeoEj3245ZlkjpBRpZl8vePmTmNkIGzcusSmSYAALB2EThhqs3Pz0u9QUJRBilTp/R40PDd2c5J0/RrQghqNpvtiXGt0t6YGimFNMb7AQAAsGQInDDVrrvuuudr8OfA0kKppPlbb721IulwyTLejKQfTJJElUpFSZKo2Wy2g6cxNVIkNMZdDgEAAJbM2LbcgBWyruTxuvKMU5B09KqrrpKkH9JowcWL9u/fLynvqmfjncZ4bNBIkRCBEwAAmAYETph2PnAqGqBTU6dM+aFms6ksy94t6dNDrj9Iql155ZW/J3WPARrj8UCjTICrRqOhJEnGORAEAABYNAInTLsZdcYtGV9Vz4KmIKlu3e0k/ZyGCy5s2W954okn2neOc5bmhhtu+OQoz7dS6x5BFAAAWGsInDDtZtS/glyi7iDqKQsIQgj/KOnGIV8jSNq8e/fuN7SKUYxzRb2Rx16NcxAIAACwVAicMO2qJY/bWKZU0lySJD7D8uYh1u+r8f1gpVJRCGFsMzIhhJG7ELpgcjk2CQAAYCwQOGHabVQe3FiXOqm78EPq7j9hxR2yLFOWZX8l6X7lBST6Sd36z6lWq1+fJEm7LPlqK9qGdevWSSPM42RZNJ+pGuPxWwAAAAtC4IRpV9HwQULTAoIkSSw4eIvyAhJSJ+DyxRWa6nzOKpJeu8jtXXajBj3M4wQAAKYBgROmXVWdwKnfRLj2u51ZsuDi8OHDb5V0TFJDnc+TjY0K6swDZet58T333LNEm748Rh1/xRgnAAAwDQicMO1qBffFgZT9no+fuHPnTkn6C3XGSgV1Pldx4JVJ2njxxRe/SRrf7myjBk5FVfUAAADWGgInTLuiwKmfnsAphKA77rjje1p/NpUHWZk6AZSVM5c6n7dvO3Xq1FiMcSoK3kYNnOr1QUO8AAAA1gYCJ0w7m+DWi6OJroxTXEXu8ssvl6R/VadbXlKwrNQZA3XRpk2bvnbMM04jTYALAACw1hE4YdqVlSP3elIrIQQb4/PbyjNOUvcYJz+5rq/Q953jOjZoxIxTuP7665+7XNsCAAAwLgicMO1S9a+qF6LbXeXjrKx4pVLRqVOn/lbSE+5hK0EeZ58soPrqhx9+eLHbviwWkAkbz9QZAADAEiJwwrRbr05A1K/Lno1TOuUniA0htLuprV+/XpL+oGBZKa+4Z+uxdWXnn3/+r1jWyZf0XsmxT/61bN82bNggDR8MJZJm4vWNw/gtAACApUTghGk3ymegZ8KiarWqZrOpJEl04MCBn5Y013ooccv4intWPKIm6ZsrlYqyLGtPHptlWVdgthoWkHHiewQAAKx5NHgw7YomwO0XsfQETlmWqVKpKISgSy+9VJL+Q52xTja3kwVL9nmz3+clSfINfn1pmmp+vqd434qyIG4Eo4wTAwAAmEgETph2fgLcfuzxrvJxNsbJd7OT9HblwVhQ8dxOtg4rWf6aNE3VaDTa3f5mZmba618No1bVE4ETAACYAgROmHajNPqbRcFMmqbtbnWzs7N/K+lQ6yErKOEXqqoTSCWSvvKRRx5RpVJpd/uT8m56K91Vz/atWq1KowVOo8yFBQAAMJEInDDtimpv+6IQcrd7JiyyAMe6t9VqNUn6U7ce/xnL3P1S3qWvevbZZ/9kkiTtsU6+AMVyKxpPNeoEuCJwAgAAU4DACdPOooSiDEscvfRMvGTFHCzwSNNUt9xyyxui5wb3u65OAFVRHoy9qtlsKk1TJUmiJEnUaDRWu6veSIssx3YAAACMEwInTLuy6CTOOuU3WoFSUZDxzGc+U5JuKliuojw7k6qTvapKenq1Wv0vtt4QgqrV6mpX1RvlxfkeAQAAax4NHkw7m8epX2U9m7A2UafUeDsbZIUhfIGI1u23uXU1o99S99iqVNKr/XrjdS4XC9R81qxllNJ+6+M7VitbBgAAsFwInDDtRmnh92RhbEySzzylaapDhw69U9JTyjNLNXWXI/frs6DtZSdPnszvbAUzC+gyNzIf4ETBzihRG131AADAmkfghGm3qAlwbYxTlmVdGZtdu3ZJ0vuUZ5Z8UQiffbLiEZmknZs3b/4OKzRh61wJfbJDPeO5BqAcOQAAWPMInDDtiibAjbWr4MXjjqyangU7NhdTaxLbt6u79HimzhxPPktjn8PXWBBjxSJWUU8FwQFqqzUeCwAAYKUQOGHajTSPU9GdPmiwog4zMzOq1+ufkPQFdbrjWQBm46bi9e47cOBAu5veagUjrdetj7DIzID1AAAArAkETph2ZRmnogCn82CrsEKWZarX6+37pPZEsn+mzufMzw/l53Ky7NO6yy+//E22vpUusBAFOqNknGYIkgAAwFpH4IRp16+wQVHU0jPoyLrnpWmqWq3W1cUuyzI98MADP6u8Qp2fQNcCsLjLniS92ta3UmOcTBSojRI4McYJAACseQROmHbDpnWCCqrqWTEHKR+XVKlU2gFPmqbau3evJH2i9ToWJFnBCOuyZxFSJuncWq325dLqlfRuvW5Tw8/lxPcIAABY82jwYNrV1Bsg+CDJz+PUM7dRkiTtwMnKhxcUdfi96O+m8s+e77Ind/u11lWv2ewdVmXd4paie5xfR7TeWQ0fVK63suy+GuA4zOVkxTpMvL92fO1+2/a10vUw7j5q1R/tbzs+/j7/fGAx/PeXnWP+XBuUVeccBDCOCJww7Za1dV+pVHT06NE/l3RMvV39LChL1SlP3pT0kqNHj7aXjxu17YWXNzAZpZ9gV1e9cQiYTGucWU+DzViwa9tsQe9aabTVarV2QCvl++knO7ZiJnZ/lmWFwTqwEH4uOjvH7DzLsqzrIpPd558PAOOGwAnTrt9noOi/9oJa09u2bZOk/6e8q54Vg4gDk4rycUUVSdvPOOOMV0udxoQ1IvoFAMtg5HLk49rQ8Rkwy4z5K95+Dq6lzOaNA9tXC4Z8gJhlmRqNRvs+a8hWKpWu0vrAQvlzyAdGlUqlJzOfpmlPIAUA44bACdNumM+ARQQL+k/earT+futPuwSbRL/9Yw1Jr5XUbsjaenzXwKVu3EeBT0+3xAG6ypGPUwBlwYDPsvjsizXW4gmH/ZXySRc3SK0xm6ZpOyNnBUn84/YYsFD+HPLfXbGiC0KrPI8dABTimwnTzpcjL2vxh4UEBZVKRfPz8/8h6fPKs1bWLc9k6ox3ypR3fbv+vvvu62pMFHV7WayidbTuGyVwWuczYuPEN778sbRAyndLiycxHrd9Wag4G+iDJQsWrcuef3yt7D9WTwihndH1mc04m+S78QHAOCNwwrQb9jNQWFWvdKFWY71Wq0nSX6hTXS9elwVNtj0zF1544Rutge+7kK3QGJRRJsBdV3TnODS8reEmdbqn+eDJqiAWZZvWQiPON0bjblPValVpmnYVyLDnrMY8Ylh7LMvkv8csA9rv+2EcvjcAoB8CJ0y7QZ+Bomp7I/GDoe+4447/rc7YIb+uVJ2gqaE8I9WU9ErrQmWNDmvsS0s3BqBPQ2XkMU7jyBpufmyFZZV8wGDPWWsBgw8KLZNk3Rfr9bqOHj2qarX6miRJ3lOpVH67Vqs9zx4f1/cUkyPO8safLX8hI14OAMYRgROm3cit5FH+qfvnXn755ZJ0o3tde9Bnmiru56Kbb765a/yJ1Cnxu8xjAEaJygoHBI1DAGIZFNuW+fl5JUny5bVa7Xeq1eqHkyT5QLVa/YmDBw92jcFYK5Xl4qv7NkHz7OysZmZmvmvHjh2HJf2BpJdJ+l5JH69UKm8/ffr0WLx/mGz+HJqfn9fNN9+sJEm+OUmSV6dp+vJKpfKSNE2fd8899+jEiRNdFR4JngCMI0b/YtrZZLQ+CvFzN8ndrkujBQTNZlPVatWX3v1jSfvU6ZqXFLy2SZ/znOf8QQjhOxuNRns9VqJ8KRq2fj12283jNKyNResYp4Z3CEEPPvigzj///P+Q9F+ih1+6d+/eH5H08izLPi5NTnEIOy/styR/rvW8D62M2/Ml/baka9WZn2xGnfPwuzdu3DjbaDR+ZFKOA5aHn9Q7Dmgsc+tL2sfnW71e18zMzD5Jr5L0DZLOVO/3qi6++GL7+4SkhyXdI+mgpC9Iuv/GG2989/nnn6+dO3e2s8Npmnad9/E4Kj+3nD3uJyy3brz++7To+xAAvISrOphmSZLcIOk56s08FQVOXx1C+MdRX8M3Po4dO6adO3eekrS+4DWLHDx+/PjeLVu2dDZsCYOTfg2FJEn+VnkWYpgX+Kcsy15qXRLHrRpWlmU6cuSIdu/efaeky5QHrHXlY7MstVSR9IUjR448fceOHWO5H8Mo2m677/Tp09q4ceNbJX2/8vc1fm8ty5hKym6++ebK1VdfvezbjMlhGUv/vVN036FDh7Rnz54flvQ6SRcq/6w11LlYa8G6NUDsO9ZXMLWpG6ROd+bHlQdVd0q6X9JNBw4c+LsLLrhAMzMzPd+Jg74j/YTdPii04IrACUCRyWsZAEtrlM/AyFcZ7IqmNS62b98uSf8gl8EqcdbWrVtf1mw2u8Y5SUvfFS5a3yjFIdrlyMetoWGNot27d79VnaApVd6QC+p0i8wkXbxz584/nKSLSfPzefFDKxriu+XZFfVWo/YFGzduvEfS65Xvv022LPfb7pek9JprrnnLSu0HxpOviid1MrHWBbbRaLTHDTabTd10001KkuQP9uzZc1LSW5R/5qx4jAVNmaRa67YFS3buWRGetPWcVJ3v6FTS0yQ9X9JrJP2spPdfdtllYd26daeTJLktTdM/T5LkfyVJ8lW+Kqkf62d/W8bMX2jwGatx+y4DMB4InDDt4s+AtZr9f02feRqp7701ZCuViur1uv3z/oPWw7UBi5qmpNda48SPVVkKA8qIz2v48V/rl2RjlklrH1+p/FgG9+PZFe1Xfe5zn5uY4ggzMzNdhS+kTheqJElUr9eVJMmvSPqw8iv/qTr7XnG/gzpdR6X8WD17RXYCY6torFGSJO3uedZNNEmSl1er1X9+9rOf3ZD0akkb7enKzyU/ZtIH6D0vqej7Vt2f1aIPZVAenF0p6b9L+nlJ/3DhhRc2K5XKoTRNP1qpVH61Uqm84u677+4KluLS+3bxYRKzzQBWBt8OmHZ+HqcyC2pJW+OjVqtZY/aflPffH3b7XnTo0KGuf/jLOfak1YiYG2GRdfHV2XEJOtI01VNPPSVJW9TJLiXqbaBZJip99rOf/V4LPMZdPEdOs9lsj6u7/fbbtX79+lsl/YQ6GTYfOGUqvlDQUH6chgnsscbZRRsvyzILyr+3VqvdIemvJL1Y+Xlj7QrfDbboApUPpjJ1n49S+fx6/vGi26mkXZJeJOnHJf3lJZdc0pyZmXksSZK/T5Lkp5IkecHJkyfb46VsvJPtIwDECJww7Za1q17cvS5NU7vK+dcjrGbTnj17fsCuji4H372rZZQJcHsyTuNUFWvjxo2SdNzd5RtofmyFNfS+9rbbbpuIhlOapl2NPZd1et1VV111TNJV6jRQfYBov311R/ss2In24eXefow3C8z9Z+HgwYOqVCo/uW7dukOSfkd5d7yKOtMoSJ3g2277z5tNAO6/e61Lnj8fpd6AygdRfp1xVipeh19+j6SvlvQLkv5t8+bNs0mSfKBWq73uyJEjXd/VABDjmwHTrmwep7JuIgP5uUv8WIEbbrjhh9RpZAxi2/BtFoRZVmG5tLZ3lMCpcIzTOGRsrJukpH9T51jGV6gb6p6YuPKsZz3r7ZPQcPIVzrIs0+HDh1WtVv9SeYN2i7orRlrj1DJPdhJZhcfg7rv96NGj/3tFdgJjzcr0P/jgg0qS5Nf37t37pKRflrQzfqo64wUt+A6t275SqT2nqNtsURfa1D0WL2NBmC8qIXUHWL5rYPyllLS27yWSfveMM844miTJbx0+fHhsLvwAGC/j3zIAlteKte59EHX99ddL0t3DLNb6ue7AgQPtCXB9lmGpt7HFXyUuUxnXRoYFFJLeq94y89bIqrrb9vubnnzyyZXazCVRqVSev2vXrs9LeoW6B93bPvlAySqW+cH41qh96M4777xq27ZtK7j1GEdpmuree+9VkiT/97zzzjsl6cckbbeH1QlcfDDuA52+q1Zvl1lFf8fd9op+LKtlgVgaLd9vTJQfz+czXdsk/cCuXbseSNP0qwdsP4ApReCEaVdVcb96u+3/zqTRMinWxcWqNNnfrYzRH7WeFg+CzqK/m5IqV1xxxc9bpmmpS+UWFIk4oeGDyg3+j3Hq4maDvY8cOfIuSU+pk3HxmRjf2LOG2OadO3f+sFUPiwPDldpHe31fEcx++9tJkvyopA9JuqS1qN9gC5581ym7nah7PNvtX/jCF8697LLLuOK+BvjvH0k943f6nV9Zlumuu+5SkiR/cdFFF52U9F3qZJZ91zd/HlngInVndhvqDlRi/brZFQVQRcFQnEWOM8vx84uyTvFzzpH03iRJXiF1Pm/x5w7A9CFwwrRb1oxTPB+Ir7J37733/pryst++e4lvfFijw7q2fLN1H7Pyv4tVVDGrpTHCarqKCIxDFz1jY362bt0qSX/auttnYoI6jT+p04CqSvpvNq4sDixXqhufvX6apmo2m13zdyVJotbA9j+X9GuSNqk36Lb30WeefDeqpjpj1D702GOPXXXBBRcwh80a4c+b+H5J8eTcSpJEt9xyiyqVyp9deumlTUlfr7xCXvy9ZN9V/gqC3e/vm1d+vqXR/Z5fT1G3O3s8DpCsWl+8Pf22Lw7KirbdB101Sb/9yCOPtI+N/RQdUwDTgcAJ067ov9+SX0qM/8nW63VdcMEFkvRJFTfc40ZuIuniNE1fEJefXo7tU97gGfY4bPDFIMatQWGB6uc+97nXq3u//Pdf0eDz599zzz1dV5nj9S43P57N3m973VtuuUVbtmw5oLwEc9w9yk4On1GNq51ZFqop6S1zc3Mv2b17d3sy03p9lKm8MI7cPF5dE77aOe0rdX72s59VkiR/e8011wRJ36T8fLGg2gcW/rcFREXlxpvKs1R+njDTKHh+XOzBj8crKmEeV+uLC074dft9iJ876IO8++yzz/4py8y1X7hSUXwfgOlA4IRpt6yfAeui57t52DilVgPYuuv5Pvr+6q7UPS7nlSuU7ZhTcVBZZF3cdW2curHYvEbXXHONJH1A3Y20fvtYl5RcfPHFb4yDwpXcNxvPFkuS5NuvueaaJyVdqu6r5747ntQZg1K4eklPSvr2er3+hpmZma6gt1ajGvmks6BJ6kyWnKZp+3upWq0qSZLnJUnyvuuuu64p6WXKzx0LiHx04Lvb+eyNLzrin9suttK6ryHp05J+WtKXHzp0KJmdnU0OHjyY3Hzzzamkl0p6rfJqd38u6d8lHVV3V1LLIsVjEuPbUu9576v+2brifYkzXpmkffZZ8N30lrPKKYDxlYxTAwdYaUmS3Cfp/OhuH6h4Lw4hfGSU9furvNZg8YHPoUOHtGfPniOSdqgz7ia+qutLSB+t1+tnSFqSf9z9umQlSfLdkn5vmFVISubm5pKZmXZxvZ79XG2ue9vzlTfIrPtjfLyl7mO/P4RwpT9OK5lZi+doyrJMMzMzvyTpJ9XdZck3TuMTY16u8qGtWtIdt91225VXXnll12vV63XVarWxew8xukaj0Z6s1p+vIQSlafpCST8j6YuVnzNF50ks/ozEF3k8Gzt4v6Q/OXDgwM9ccsklXd+HMQvo/HMef/xx3Xfffdq3b9+3KZ/k9hmSrpB0nvL5yYq20W9XUZfcfvsU359I+rMQwrfZ9hV9jwOYHlwywbRbkf9+1mjxjeA0TbV7925J+qikl7ttiQtSWLWqiqSdtVrt60II71/K7ZJ6gqhRJsDV7OysfOA0bmxcQgjh40mS3CDpeeo93j7jZ/dddu+99+rCCy/sGlu0UhecfCDz5JNPavfu3f8o6StbD1tmwFcWs6v8/vaMu8+6KL3r5MmTr9q4cWNXoYtms0nQtIbEF1daAdPXKZ8U+XnqjKOU8vPEF03xRVTiTJOfSFrqfD/Z8+uSPiXpN0+dOvXeDRs2dBXIsXOraJ47Y7f37Nmj3bt3K8uyP/UXL+bm5nTnnXfqWc961jdJerakZyoPqs5R50JTUfe9+MJU0fet3P0f8gGd1Mk8j1u3ZADLj/+MmHbL+hnw/+h9A7VSqfgG+DvUO29SnPWquOd8eysIWPT2DVjHsPM4JZJ0+vTp7jvHqEFRUNDh7cobdjE//qEdfFx00UU/vLxb2F8IQbVaTbfffrt27969X52gSeoMuje+xLOvdiZ335yk14QQXrVhQ14MMU3T9k9cDAOTzb5z6vW6kiT5ljRNb5b0HnWCpqY64+CKskcWIPkgymduioqRvOvGG2+cybLsBVmWvdfOM2MFcizw8N0J4+8jn92NL/LMzMzo2muvVZZlf5Fl2Y9nWfaVzWbz/CeeeKIi6cXKs7J/JWm/Ot9nVlBCbr/6aUi68+TJk+/y2yh1MmMApg+BE6bdsv73s4aLbyD4EsCtjMLfSTqp7j73xjIgNtBakr7y5MmTy/2Pe5R5nIKNnxjHrr/+6nCj0dDc3NyfqFMiuV+lLbtSHSR91WpdXW41GL/mqquuOqK8e5LUO3FyUPd++HLR3h033XTTxhDCH9v+FJVWjh/D5JqdnVWSJN+zbt26z0v6M0lXqxMMSd3ZSp89krqzTHExBfuc2GdkVtJv3XPPPeuyLPuO6667rh3s2PedBUxS7/QMxk8W7oOTovPTLoT4bFCaptq5c6dCCB8JIfx6COGbsiy78siRI+skfYmkn5P0z5IeLzhcPnBsSjp94403XrFx48au182yTJVKZaymXQCwcgicMO1q6r1q2u9KZHPUOTx8mV8Tl5hu/f1n6g7i/O14stJN27Zte62krspO/h/5sP/UfcPEN1okHdfwQWV26tSpIZ+6svy8V1J+7FtdCt/XeopvHEq934mJpBceP3686z1fqiAqnmenoCH5Q8oHyu9Qp0FrjV1/lT9RcYPXHv/LkydPPqNVIKOni5Tfn6L7sDziKQWG/V6x9y9e3r4PDh06pCRJfmrTpk1HJb1VxfN7tRdT55zy4+WCu0/qvaggScckvengwYNbQgg/dP755/cE4767oJ1TVvDEd83z55tlQIsei7NPcfGUoszQjh07FEL41yzLfi6E8NK5ubkzP/3pTyeSflHSZ9UJHEPreLznzjvv3Hrdddf1rNe2i66swHTik49pt6qtQ/dP/y8KHo4byt43xpWd/LiBYf+pFzXUWg2EUWpRJ5ZxGrfGtm+gRRNYvledsRjxOAcvSJrZvn37S/2dS3W12YLneMB5o9FQkiS/JOlXJW1WZ1yJv9pvwVKtdb91ufLd805I+oEQwjf5MWhx1yOsDt/oH1SZ0t+2cuJWndMez7JMDzzwgJIkeeuePXueUh4UbFL/gg+WyfbzevnvGhv/VFWn0INtyMOSfur48ePbm83mm572tKe1z+NxCihsW3yA2SqwomuuuUYhhDeGEK47fvx45bbbbkvuuOOO9Pjx47Usy15x2WWXrdZmAxhjFIfAtBup9bhcjc1ms/mflUrlLklPV+fKpzWUk+i3JH3pQw89pHPPPXfJB/K39nFW3Y3wgYucPn26bwZjNRWNkQgh6Pjx43+9devWU5JsAEbcXS8eIP7lSZJ80HcTWorue77qmQVR8/Pz2rhx47skfXvraXV1Jhn2Y1J8o9efGxZcPXDDDTdcFF81t4b3Us4DhoXx56edUza5anyO2efcf9ZtLqaZmZnnSvoR5RPWWqU5C6bl/vbsgoGfNNaeZ7er6hQakaSDkt588uTJt9jYJZ9FsgDOd6VbTXG3Pt8FtVartbd3y5YtesYzntF+jjR+lUEBjAe+FTDt+n0GVqTlb1eZW/+g4+56Xjz+qXbeeef9UNETl2J8yk033fTxAdvSY9++fS9c1AsuE1/a2I8327JliyTdqOLukf7Kuv1+sS3rr/gvlmUMfderjRs3fkB50GRjlSxoikuN2+2muiuEJZI+8uijj150/fXXt7ezWq22G4NuHjGsoqIS95VKpafB7gMp05q89r/NzMx8VNInJL1CedAU1MmkSp0uvkWZ1aLJZX2lPV9S/Pueeuqps0MIb/HjfuLtjArfrCp/IceyTvHYKN9t1QKpUbL2AKYL3wyYdkUz0q/Yf3zfve7OO+98kzpFC6zxEo+3sm1tSHq1/YO3oGDUxkrc+LflrWE0gg1x1atx0G/Opdbx+kflx9pPEhvP6WK/r3zkkUckLf3YBuvidPr0aa1bt+4fJH156yE7N61QhwVKfiC/1D3YvyHpF+bn57/izDPP7HmdcckEImfviQ+g7Mc37H3Q/+ijjypJkh+v1Wr3SvprSS9qrc4mbE3UCbaNf+PjYiK2rFWc890+H5T02tOnT18QQvidzZs3t7NccYEGX/jBtnUc2HbFGVbbdgv07D4CJgCD8A2Baec/A6v2nz5JEj396U+XpM+os00+u+C7jlnD5uo777yzaz0LnZw1fv5CAqdRF1gJcdcnuy9NU91www2/qk555Thg8gNOGpKqZ5999tf7RuFSjXNKkkSnT5/Wpk2bPiDpq9Rd3a/9NLddPsiz5zWUD9T/xizL3lir1VSv19v73mg0ujIBzEEzHooKG/gKcf7cTZJkX5Ikf3zWWWcdVT727Ry3qFWE899nfixczHfTkzqfA7v/c5Je2Wg0Lgwh/NH69eu7Fo7nh/Jj5sZt/FzR2LFms9meUNq21d8HAP0QOGHarep/eP9PutWwf5c95J7WLyOWPOMZz/hF3xffBweLEc+9UiLRmAZO/gpyVBxCV155pZRXD5R6y3n74MRaty+0xuxSjX+wIG7jxo1vl/QSdcZX+e6C9kLxWBSfjXzg1ltv3R5CeJ9lBGq1miqViur1erubXjyRJ1aXr0AXN9izLNN9992nJEnemCTJncq7471K0rbWU6xog1ScJe/7vVHwXMtWfUbSy0MIz2o0Gn9aqVS6pk+Q1NOlrWh//PNXm3VLjbtD+i6RVmK8qJskAHh8Q2DarWoLMi65+9BDD/2O8klKUxXPx+MLFwRJr7C++740+UIDJz8epuC1i9hzZgY1olaLn3vFX8nPssyyareot2KY1KlY56/Mf5GkduNqKRqGrW16naTvca/lx6TIbVuq7mBJyoO6Dz/66KMXX3XVVfmTWxPZ2iTJNgi+qEsYxoPPiD744INKkuQNlUrl409/+tODpJ+VdJm6zw2pO6gv+r4o+26z75KmpI9L+uoQwvXNZvO9Um/JcF80wc9LF3clNOMQgBR1YS4K+IrGlAFAkdX/ZgOWUVHjMLpvRt2NDd9gLQpalrSbUzwPy1lnnSXlEzT6hrIXdy18+k033aQsy9pZhVG2r18J5FbxhGFYUNFeIG6kr6Z47hXj/v6YugMU++3ns7H7rj158uRIYzh8MCv1no8333yzJL3Zb7K6x1xJ3XPMxOOx/tCPZ7KsklXN84Pj/Xtit+Og258Pfp6geG4ee/6xY8c6Gxk1SOMsSlGDtei+QUYN+OL98dsVz4PkC4gUbX/R6/a7WGHL9ptnzZ5rwe3999+vJEm+P0mSj5133nmnJf2GpOe2nh5/5uPxd4oel7oz1kURvgVNH5D04hDCC5rN5gcl9VwUiAOnfoUrxpHPxI9rV0IAk2U8v+2AJVL0DzK6r6jS1Irx87BI7X/071bxOJciYd++fW/38wCNErT0e17r/vmhVpJv67p4fNWEZDQ+pe6ucFL3lXy/Extvv/32dsNymGNsY0Gsge6XaTabuvbaaz+qfJ6mrsXc9lgWwQJ629Z5Sb+UZdl31mo12Txa1jVx2KpmlUqlXZzClpc6wW88BscVJvi3JElOb9++vZ4kyWySJLdWKpXfSNN0n9/XNE3bwYNvsFrA4O+LgyILbuJuVj7zUaZoElWfLfHduOJunYMCAts2KyVv54MPqi3z57fFHq/X60qS5Pm1Wu2X0jT97AUXXBAk/R9Jz5NkA4qG+RD3m2/Nn9OpOgVGpPzc+X833XRTkmXZV4UQ/i2+2OLfNwBAB4ETpl3cOBnUWFmWSMBXz5KkY8eOvVv52JthPp9B0itmZ2d75ncZRlE5ZPf71HB7oETSyNUkxsHDDz/8/9QZJ1KUafRd45J9+/a9Xhp+/IY9zwIQCyqazaaq1er3Ka+I5sdWxfygfcs2zUt6Q5ZlP22NdT+5rQ1yHyaws8yUn3jXb7dt78MPP6wkSf7P3r17TysvTPAC5Q38amv7rpL0Bkkfr1artyRJ8n1Hjhxpj6+KA6J44td47JUPqvpdCBglyxEHZXFA5rel0Wh0VYgrGn9k2xRXl7OS4b6LmI2Ju/vuu1WpVF6dJMlfrlu37jFJ/ynpf0p6lr28Rv+fXFMnKIqX9UFTVdJpSb/9+c9/fl0I4eXPfOYzuwqFxAFpXAACAEDgBKxqxklSzxX3rVu3SnkXmmGkknZu2LDhpbYO/3uhWsufGGGRTZPY/WX37t2S9HDrTwuS4u9FC1ok6Vpp+Ea7ZRnsxwKGVhe3n1Enq2T8334sm2XBGpK+N4TwNgu2rbHuMzvDztNkjX9JXUGOZaJajeqfOvfcc49K+n7lXVvtmPjS1e1dlvRMSW8944wzDs3MzPzy/v378x2LujjGJaD7BTOmX0GCYcTBV1G3RduWarXaft8seIu7d/mxgHEltiRJVK/Xde+99ypN09dUq9V3VCqVBy655JIg6Q8kfaOkPe74+fc7LhtexoIiv5zN62VdTh+V9ONPPPHE5hDCD1xyySWSOmP14nFKSzV+DwDWIgInTLtBrf1ljwR8l6+oi9UfjrCapqTvknq6/JUqaYQ+NeTrB7nAaaEl0VdDrVaTpNvUO7dN3HK0A/osafjja93g4i5pZ5xxxi8pbzz7cujWcO6X+apLen0I4Y8s2LFxSkmStDMEvhjGMKzx3zoW7W2sVqsvrNVqd0r6ReVj2OKxVkWlry0QqEg6Q9JPXnnllY00TT9UqVRe2erq1xUkxVmPOPPUPgBRQYJhAqiicUc++IovWvjgzAKIokxVe6dbwfCRI0eUJMmXJ0ny00mSvG/9+vX3XXTRRUH55/g7lJcOjwt82G0r/uF3KB7n1o8FrbZsXZ0M5ackffvp06fPDSH8er9xi9Ek3D23AQAdfDtiarUaQGPRuveD1JMk0alTpz4s6eAQi1om4ssOHz68oO56Axwvf0rbpiV83ZX2OfUWiIiDF/v76bOzs0Ov2Jc7tgZqayLdN0RP9d0F4/Ft1tB+Y7PZ/P1Go9HVjSru9iYN/x5YoGDryLJMR48eVZqmvy/po8qrudk2+MCu4u6Ps3RW4c0eq0j6MknvPOuss04mSfKvaZr+2E033dRVyKSokES/8U/DjuMryjL1Kw7gxzX5ixn+tRuNhu69914lSfINSZL8j0ql8jdJknxh9+7dTUkfkvTzkr5e0nmtfbeBQv54+Imt/fllk9BK3XOLDcMv97eS/r8QwnNDCH++bt06SerqzhmfJ0XvAWOcAKAXnZgxlcalHHN8Zde6B7XmUXqvpNeXrMJagFt37dr1yhDCu5Yi49NadtiMk+TGOE1Cpsm0jtVnWn8OqlIm5Q3brV/4whd05ZVXDlW90LI/PoA655xzfkPdBSDS1t++Ee2DkUzSu+v1+q8WFTCQ8sDbquhZIDTs9tl2tYolvFrSryjPhvmy15bxqqm7a5kfR2OZjix6zJZvKj9PXijp+dddd92vSzoq6Sbl430+d+edd/7teeed155HzHeXM6Oc377wg1/Gujb67mr22OnTp/XYY4/p8ccf1759+75V0gWSrpF0pfKAaJO6A2v/Xlkmzt5De58r6lRqrLaOpXWxs+52FizZ84b9IDWVf1bfcffdd7/hwgsv7Pu9InXOlXhskz9OrTF4Q748AEyPZBwaj8BKc1Wx4sZhP0HSF4cQ/mOYBuko4ivrbuzKc5VPelm6itbvDzSbza9eSDcb/7pu7Mf7JX3tkKv4f1mWfUPcwB33ICqEoAMHDuiKK67wleviACbeiW8MIfzNKK9jDdfjx49r27ZtTyqfxNQ3vuMAzQccdx8/fvySLVu2qF6vd83L5PdDUleRkWGOvW3XnXfeqSuuuOJfJH2JOoGAn+fHggFfpt0fr/jF/H3x42V/n5b0oKR7JB2QdFj5OLSDn/rUpz6wfft2bd++XZs2bdKmTZs0SJZlmpub0+zsrE6ePKknn3xSV1999YuUdyPcqjxAPEPS2ZLOVR4YnalOZbuic2IUvuui1DuJsX+eX3/Z95H5V0l/fOLEiXdt2rSpfV7Y+1r03dJ+QTce0p4rqed7AADQwSUlrGlFAYGUZ3qiLldlrYREUnM5LjQUDTpvbfMnkyS5V9L56h1P4v+2hu5LHnvsMZ111llDN3ziK/r+eCnPBgwjk7S9vTFhfOZxKpNlmS6//HIpL4SxScUN5XhOp6tDCH+zkOO7bdu2H1F+rPyJVFen6IJn2/Ka1mS9PeXB5+bmtG7duq6Mgs8cxIGW/W2OHDmi3bt3v1nSdyoP5myfi7bDjkO/wMdfhIizUfaiRZXj4tfbIOnS1s9L/QP79u2Lnqpma/3z6lSXqyo/nlUt/n9cEv0ehR0Xf8wsEJU655RlnHzw7sXFQh6Q9OcHDhz4yUsvvbR7Y10XQ/93fNv/Hf8uei4AIMcYJ0ytCcm2/ql65xkqGpQvSenevXvLuvZ16deYahmlHPn6SWxsuUDk8youyiD1NmQvl4afR8hnASR9a+uhzP2eie7zE/H+9fz8/McqlYoajUbPHFIWNPly574qmgVJdq5bENWaR+i7d+/e/ZCkH1YeNNkYm+Be3xr18+oOAObVCabseb6Loc9WWdBkg2asO9pSqEhap3wurO2tny2t+1biwmBDvVUR44ylv21jvqzrng+aLBNlx1KS5tQ5vn8n6Wufeuqp80MIPUETAGD5EThhKsSN+nEZ41Tmjjvu+Bl1lxc2vkHm73+11N1la5CSSnjDFIewFyku2TUBWvt+i7qv9vsDEY9nudbP3TOs2267TZKuU6frVlzFLw6QmzfeeOMrLPixMSdxEQUfnFkA5cdUWQbKCpCkafq1MzMzt0r6XeVd1Hyhh3hsjQUfFtw13d9Wwc2eF1faM9ZdrapOl79KwfMWw4IOX8BiJT7gtk/Gl5C37fKZJAs2/XgnX0HPj4vKJN0t6ScefPDBdSGEr8uy7O83b47nSwYArBQCJ0ythcxVstJd0C6++GIpr/oWX9WOG/jWULv27rvvXqoxCsNW1UvkAqdJCEiNO063q3gCWqk343T+yZMnR1p/lmW65pprftHuduv1pcgVPf6x6667rh382LxKNteSL5ltr2XH3gdMFkRXq9UvS5LkRknvUT5hrRVy8PsZoh+fQWmqkx3J1MkkxRMIS51sUyV6zAeLS3mixNsdb89y8Rk602/8lh1LyzjZnF2WfbKM342S/seBAwcqIYSrQgi/dvbZZ+crdp9p5loCgJVH4IQ1rSjTZCah4dHKNrxLncaV1JuZ8APOK5dccsn/HjVoijNPrd/DVNWzF2qP0p+kLntuW29Rd9GDoga+HeOZe+65Z6jzJxpz8jJ1Gsq+1nMc/Np2vM2WLRqP4oqIFFZHS1qT2yZJ8jVpmv67pA9LerZ6K/rF3cv8j98+31UvKA+s36e8O5nUKWhhY40sOPCZlng81FIp2u6V4DN08XGMf/sJbv2Yp9PKi8D84Be+8IVas9m8PoTw5ksvvbRwvinDXEsAsPL45sXUmoTASZLuv//+31J3I1fu7zhbIUnfJI2e+fEZi1ZD7egIi6/3c1FNUtYpyzI9+OCDH3J3lRUEyK6++upXjhIgPvTQQ5J0sXrniYpPQjtwTxw/fvxvbPukzniser3ete2SujJNSZLo2LFjSpLkO2u12k3Kx8a8oGCf/Lb4+y0AsHMrzuI0JP3dQw89tC2E8LIjR45sUj5Oar86Xc38OCkfEPpzdSkCnDjIje9fbj4rF3fTMz5Itg/JY5LeL+m7H3zwwY1Zlr0gy7K3XXTRRV3dLP1kv/HkvQCAlUfghKlkDZFJcO6550r5ZKRxFyCp+wq2XcW+9IYbbhg68+ODpSiz8eQIm7nOqhROUsZJyrf3aU97miQdsrtU3Kj3Qev1o+znueee+1/VXVnOZ2PkbltD/HNbtmzpmVtH6hR4kPJgqtlsto/5XXfdpSRJ3rx9+/aDkv6vpGvVaaz7bmXWNcz217qNWQAQHwNb7l5J3xpCeNnTnvY0ZVmm7du3K4Tw1kajcaXycubvUJ6FytRd6MBkBfctlM8yxQHeSpyIcZYr7lIr5YHkQeVdJN9wyy23JPPz82dlWfYNIYTfP+ecc3oySjZ2zd5zG1Nnc3X55wIAVg6BE6bWpDQ8Wg2ld6t7vIS/kl9Xd/endN++fb++BC89ygS4lfn5+fYfk3JsbQxSq/DCg+oELlJvNsiOfVXSpcPsowvOr3R3+6p5Rd3WUuVdB7uCUJu01GciJOnxxx9XkiSvT5Lk01dccUVD0o8qn58o7mJn3crsdrxvcVcyqVO4IJP09ieeeOKiEMJfhRC6Jo91k6r+ewjh1YcPH94o6buUTy5sXfl8oLYc+gV7yykuH27H+D7lGaXvv+WWW5JGo7E3y7L/mmXZbz3zmc/sCoDsHCm4cNF+XnyuMc8SAKwOAiesaXGDw48LaTQafZbqvzpb50oFBhaMHD58+I+Ulwe3RqxvsPluUeZb6vV6+4q170Yn9Xbt8n/b71tuueWjfpE+t9XaHh0/fnxiAiYTbe9NKu4CGTf4g6RnW8Bg4m5zkYvceuKxU3FALEnXzM7Ots9RnxU8fPiwkiR5aZqmP58kyf69e/eeVj4e6jr1FmOQurM+9loN91oNd5/xcw3dKOkrQgiv37ZtW9G+9cwvtXPnToUQ/iiE8NyHHnpovaRXSfp75ZPZ+nM4tpRd7Ioii4Wsu98yTUlHJP2HpP8j6fWS/r+jR48mIYQLG43Gy0IIb/OBUjzPUny7veGDpwkgaAKAVcIEuJhai2nkr1TDZWZmRiEE7dixQ5I+KOm/qrtB31R3qWjLGuyamZl5aQjhg1KnS1elUim8wm38Fe+tW7f226x45xNJOnHiRGHDcJxF23mXujN5Und2xo/72frII49o79697fMo3ueo6t36PuuxeXyk7kIKL96wYcMtkj7Vun+bpDOVB2DnqHMO1NXpAlgUTNvksw11siFWHc9es+p+2/Oqyos//PTRo0f/z7Zt27oq+vks0yAhBJ199tnKsuydSZK8c25uTnfddZee+cxnvl7S85RX93u68nmY/LHw57JtZ4ju63opd3vQh9N36bPjVdStzx4/pbyb3YOt3w8rzybded999330/PPP7/tCZccGADB5kkm7QgyMYlCXlkceeURnn332KB+A54UQPrla3WSSJPlvkv5a3ZXJijbEykD/SQjhlVInS1YU0Phsht+348ePa9u2bUVZEfvbfttKXxBC+A8bnzEpbJ+TJHmxpH/2D6m7QEJ8rF8SQvjQMOdDkiR/qNYcW3aXu+2zXIn7Wyo+7v0a+f0OelbwmK/QaMGUb+n/2f333/9t5557rp+8d8Hva9E5Yefd3NycHnjgAV122WVfJ+l8SedJukDSGcqDxR2t23aBIB7fF4uDqKB8wt7TyoPBo62f08ozRsdbv4+17j948803v//MM8/Url27uubJ8t3rbH/iDLSvaggAWFvIOGFqLaA4xKpcZbDudCdPnvybTZs2HVM+Z5IfEG/jUKzha7+/5vjx4+3MkW8ASt1BZfxbkloTbVpGo6gVGN9X3I9rAoQQ9Mgjj/zL3r17/d39Aha7/SxJHyo6nvFtSZ8fsD5/n3/dOJCyx62Qg1WvK6roZsvJPeaDo0r0fPv705J+JoTwwbj0tVV0W0hA4IMmO59tPevXr9cll1yiEML7pf6BfKPR0MmTJ3XixAnNzs4qyzJZd1Sb4ypNU83MzGjdunWqVqvasmWLarWaZmZmVKvVRtr2+PPhS/XHAVTReiftAgIAoByBE9a0ooasGTFwWpWgyWeJNm7cKOXz5nxb62FrCBd9jjNJO7Zt2/ay+fn597bmgyrMHvS7it66/ZSknbY5rd/+QPrM1xa/3klhjeI9e/ZIeZnoM9Ub2FjgYhXxpHxOpJ5AwK8zyzJVKhV99rOf/dVnP/vZv+TW5Y+bLxARH9ui+6yQg/9bBdscr9tnlPxrS9IXJL1pbm7uT2ZmZnoa/f5vuz1sYBDPRRQv47v8Fd225avVqrZt29bThXRQMBR/7i075OfB8uuIK0w2m82eebL8+gZlcCftcwAAKMc3O6bWQsuRr3QXHNvOViGCdyhvANfV3RCOCw/YZ/t1Vr7ad9cboaTxE0NuZtAEZ5yk9piU26O746DGf2c+S+puIMdl7q3h/6xnPUvKiwj47E8cPPnH2qtUdwDlu0hm0fNiRQFZ/PchST968uTJp4cQ/mRmJu8NVxQ0+fPHAoph+CClqDqcHwtkx6vRaPQdIxRPAuzXVVQMJv47nlA4DnjjSob+sxLPpeTv67cOAMDaQeCEqTRJ8zhZA7VSqWh+fv5flQ9Qr6m3gS31NpBf0Jp8NX8wagT6v31D2F2Nfyxad78siCRtt3X53+PMZyBabmj9jlu+8ZxHknT+E0/kcWVRly7LWLj7fkL5WBsrONFw6/MBkUUMFlxJ6umCFwdx/r2xoiF+Gd/NT5Lul/QTTz311J65ubnfbGUzJeVd4vqVv/ZlsuNKjf0UnQfxfVmWtbvbWXn4OBvk9bvPZ/r6TRhrjw+7/X570zRtB172+bH74sBtUr5fAADDI3ACxlg8h0trvqG/UneXMd/YjltrG88999zX+y56lkHolzHwVfeUD5gf1AL0AcVmv/wkBE4Fc+QcUHf2zoKXohTCzO7du19gJcOtIW6NaCkPMBqNhjW0Pynpl1vr8hXk4q57Uqe6XRE/nslvvK88V1SWXMoDpu8/ffr0BVmW/drmzZvblRul/L3zQYvtT3ycrAviKHzgFQdFSZL0ZHfiTFCRonPMBzNF2VV7fJjtj7vu+eDIrzcOLCW66gHAWsQ3O9a0oqvNUt7oGXEep+SGG2741EpnU+r1ete4JEm68cYb36DuBrHPLhR9pr/Zxos0Gg1fIrttQIPv8YJ1+oVT9/d262LVr4LfuIm7nO3fv/8d7mFfcCMe72Re2Apm2w1xa0BbVqNarbaDp9nZ2Z+V9Put9VrKw34n7nY8bi0uLOG7+NULtitzy5yW9CFJXzM3N3dxCOFt69evLwxM7FiUzS00yntbFPTEyy90nqJRusQtpPtc0XYVFVShax4ATIfxb9kAy2QSMiJW1MFXxLvyyiulPDMidaqrFTWs7fHn33333ZLyjJUFC0N2VTqs3m5e/nvDV3TbYUFEHOyNK9/lLISgyy67TMrn7vHB6CDX+OPoMxKW1bAsTpZlWrdunbIs+25Jv6j8PZtXHkT5Ag4+oi+aKNZnwKzqoc/82fin+yT97P79+zeGEF4aQvgHG8M0Ce8NAADjhsAJU2vEwClIK18YIg5usizT+vXrJelvW3dZtTc/Rsbut9/J5Zdf/rO2Dss4DdnVymec/AELUk9XsTNsG6WVP1YLZRky68Il6Ub1n2g19iIffNk++/fNVzF0RTreKOkFkm5VpzugBUw+2+S78cVBVFAeNPng9YCkN0t6QZZlF2ZZ9qYrrriiZ6N9d0IAADAcAidMpYUUh1iNQMA3xH2XoP379/+0uotDFJUI98UBXunHYozQcD7U5zWMn19om2WzVmuS4IWwbnRSO8j5pLoLKgyy69Zbb21nlqTOeJ247HsUnCnLso83m83nSPpySX+s7kIcFiT5TJIP5mz81e2S3inpNffee28SQrg8hPDjIYRP+vPFjzubpDFoAACME+Zxwpo2qPE+SlWt1WJd6vz4mRCCLr/8cinPVlyt4glO4+IRF6Zp+vwQwselkSbnfEKdCVjjKm5ekHTGpARLxrrRSXkA1br9n62Hh9mZ7Oqrr/6RLMveEs9tZN0V/XtowVO9XpcrE/9RSR8NIei+++7TRRdd9HWSLpB0jvIS73Xl45ROSjoq6cHbbrvtby+44IL2xK5+f/zYm7gQiA+mJmEMGgAA44TACVNrMeM8VipA8A1hYwUHJP2JpN9QJ2Dyfe/8besG9h0WOA2bFfrUpz71D/v27Yvv9tXf7HYmaXdR0DDO4oqFIQQ98cQTf79r1y5f9W6QVNKXJ0nyFqkTjFgQZoGuZaDs8Vqt1jPhsCRdeOGFCiG8v2jiVl/Vrd88S36SWtsev65+9wMAgHLj3aoBltEkDJC3bIHPjlmG5J577vlNSbPqLQxhY2X8DlYlvfzUqVPtBvgwjeYzzzxT6s28+KDJdwfcOj8/P3D+nXFjAY3f5p07d0rS5zRcV70g6UWPP/541/nku0LafE5x90gLcqxyYny84klV7bcPtixYirvdFb2+PdcyY5Nw/gMAME4InIAx5ws5+HLoF154oSR9xj3VigxYtsnGH1kL+YzNmze/XCqcv6jQGWfk9R5sU6KH/SSsiaTKqVOn2ts8CYGTBTQWRNhYMkkfHHIViaSZM88883ssWLEMUNHkwr6Cn/22Lnv+saJy7vEEq35uIR94+SDJlrM5kmxy22HnMQIAAB1THzhZY6Verxc+VjTzvHEVsvquf9DjfvlBz1mMYdY/6GexVnsAus3VZF3HfGN2hDFOmS0j9TZ+l5tvQMdzyEj6M//U1m9fYc8XOUgkvSrORHjx+75hwwZJOhGtPw6g2h+exx57rKtBb5+ffufTcpxzC2HH2Crk3XbbbW/UcGOcpPx4/Kik9jxZknq+O0II8uXa/f322vZYv3mU4mDUB2B+Pf0mkrXug375ouO+kO+MQc/tZ7Xf98UqOwbDPl62/qV4/cUsP8zrj/P6l+v8XMrtW43PwEodv0GPL6fFbl+clY+PR9lxKcrq++Wt3Rm3KegNMN6SSf2HtRysoePHaXi+wYnJ5BuSN9xwg/bt21f2AbAsTnrTTTcl1157bX6nK9iwmp588knt3LlzTtKMusceSZ2udDZJbSqp/sgjj8ycddZZXespOrftWCVJcrekC9U9f5Ctv6nOWKC6pBc3m82PjfvYJs//E7RiEa1xZJ+R9OySxe24zkv67hDCO21dfE8U8/9zVuMYlb3+MNu33P8LxvV/TdxeWI39X+7zZynWv5rv36DtH/b9W8zxH/b1fVtrJfnv+6LXX47zy7ctB7Urx6VdgcEmp3WzTCyytyvFdrU2nsAz/sDHVxNGuepUdBVnIY/HV/OX42exlnv9w7x+o9Hoea+si9YQ2lXq5ufn8xtjVPRgy5YtUt6tzAI8m7jVgijfla4hqbZ37953ffrTn1a9Xm936/LnvM+0tvb5URXPa5QoD5osbVWVdJZ1fbNz1H6GOYdXmp9/yXdfa72/7x1iFXZ8ZyT9ZL1eb2c2hznXF7v/Rcd2kGGvwPornwv53hq0jJ1rwzRKyvZrId8n/vWLlil73D8nPv6xssfLtnGpPxNlx6vscX9s/Dm+1AadH/H5M+z/l2H//ww6P4c938rO72HXsxTnd7/P3qDzN16+3zqKtmvQ58c/1i9oWa72R7wN/abkKNq/fj2PBp1nfhnftvT/F+1xey8ImibD1GecrNForFHcaDQ0Nzenxx57TLOzszpx4oT27dv3YkkbJa2XtE55o3qz8gZjrfVTdb8rrds27iR1v+1bwx5P3P3246/w+9/+G7mmwco+iWWtl8VeclmO9Y+yTKZOaW4LLGzsz25J1w6xvL1X/6m8GENorW8cPjxNSRcrL1/t/xP5bJMvUy7lmaGa8kDqfuVd8Y5Lmms97ueBakh6vqStyo+FD8aCOsfWXuMp5WWz55RnYRrqvAfN1o/9bRkrv73249e/nBLlx2Omta2274nyCX2vLVnejomdkx9XXjq8rs6xlzr7lal7Hxvq3Xf/04yW9T9SfoztsaZ6j/Fc63ejtU3zrZ9663lHW4/ZfY0bbrjhE5VKRWmatrv2WVEJ/5MkSbsxUPSYf9w3VnyjcmZmpvNGjBBM+WWGFQd8Um9J9qKG3ijLx48v9xX7om0t2uZ+xykeixg/r1+BkjL2uvHrD9qfovXGk2mPuvxKrb8sczPoOaMu0+/xYc/PhX5+itax0O2zv0c5p1ZS2fs67DLDXmT1z3PTYmBMTX3gZEIIuv322/XMZz7zXZKeK2mXpB0q7v4kd1/8ePyc+PkjbVb091KsY6HrWS7DnoCL2WYf/Pjbo4iDj6L3fTXYdth+Ze7viorPX/vbH4tB+1P0mF/Wjs1Cj+24WMx7HO/7oM+9P+f7fXf0s1TnnA+sfYDqA+PlUrT/PljuF1j6gDsuWJIVPCcOVIuWDwWPx8HtoMeTEddfFDwP2v6i1/frjwPz+HbD3Vf0vHqf++PjP2gdg7Y/K1m+3/bb7/j14+eUbV99wGPx/seP2/oXtPynPvWpT/W7MGC//YWFogsPfrlhH/fZHP/bP9ZvOILfVmm0wHLQ40sdGC1Vu7Vsu+IL63FQaBceBj3H3xdnSePJ0eMpKsYtoERu6gMnOzmTJHm+pL+XtF3d/8ztn2NR8FT0mL/fP3dQozQ2yqdlMYHZKOtfLiv5zWD/xP3EsGWv3x7jpM4/+XELEvycQ/2CIb/vvtEc63fO2+tY5i4O2PxrFz3Wz3Kfv2X6nQPzyrNQw/BZMTtPLGM8KEhajGGPW1mQttBt6vf6Ibo9ymckXrZo/cNaqfMp/n4sC4SHDZTj/x/9lh/VpK9v0OOL/V9a9DrxZzh+vN936KDXX8rvhGHaF4NeI0Q/WfR30YUL/5yijLgP7OtDPu57JfjnNdzjcUY9qJNxt/sa7rnx443Wj1/HvHt+vfXTcK97Wt3Z+rqk+c985jOfrFar2rBhg6rVqtavX6/169dr3bp1qtVqXXP4FQWTPjD1xYTIOk2GqQ+cpHa5589LusTdXfSFVPSFt5B/8Iv54lzuf1SxSb/kEWcRzGIaZj67Mw7Bkw/kU3UCKds+fwwsIyUNbtj7AMrW4x8ftO+LPS7LFWz0ey3/Gnas+p03Rfrt77CT6A6ymOBmMesva9Av52sDZtzPkVEvjI4aWKPYclxwG+bCTVl7UOoEWg1Jx5R37z/R+nlKeffoI62/H5V0SNLdjz322Kd27tzZ7uKM8UXgJClJkm+Q9DcavqFUZKEf5GGuTq2VL9OluCK40H80/v0ZtWFvV8d8NmVcxFkea/Db3/1++2Wl0TIY1g3Q32fLjpJtGjfxti/0vR5luZU4n/p9ZlY727ccaIhOlqXMEk3i6y+nYS6KLHfGaynWPWj9K3GBp9/rDvO/ctDFybgHTEPSQUnveeKJJ364NYcixtCkNWyWXKuq1vPVfUVeBbfLFHVtGmW5fstaY9j3mZ8ElrHwkoKfUS1kecuyxNsz7LG0Yh3+y3Jc3gfLKPkskv0Ofe73y8rdb10R+83TZOuLLzDYe+HHV/X7bik6L/pZ6WNsxyaN/l7oegbxGb3l4I9zv8/MQj+D42zY74dRzsN+yy72/By0/FKsfzktx/YNez4u1fH3r7mY/0njalCbYqn2dTmP2TDbWfT+rcR7OMxr+P+5RdtlxcL8EIBzJf3Qrl27PsBcTuNr6gOnVkr0InUah9ZAtturza5IDGqIxv2OB/0M83r9+juP8o9qqb7AlmJ/7NjFDeJR/kn758cp/Xhb/LHr95yi5UdtCNjr+KyR3Z4fYT2+nLivOhjUncFSn982gDruvhj3R5d6z4uiwfByz12ssuNaduxHWX4hn4+y5Ys+26Osv8xy7V+/5Rdyjo+yfaMen2He/37LDrN82TaUbd9iLWT/htHv/B30XhQ9vpDGbr9lFnuuASutoe52iUVLX1GpVL54dTYJZaZ+9Fmrq+Ip5eWZiyqFrTb7MFkAFXezWuw/WPvn5V+v6PZqWew2+GDHB0zDdiXzx78oE9EvAxVnc8q2r59BwYRvvEidLnQNjVbYwK562RUwyxzF2aU4OLRt8N8jcaGIsi4Wy31xouz4FjW+ypYPJY/75yxk/f65ox6fUYPPxT5eZpTl+wUpg54/6vat9vEZ9fXLGv+T9P4uVSDYb53j8P8KGEVV/S+ofq2kf1/ZzcEwxiGjsqpa1U0+p95yzuMyT4/UadBK3Q3OosyHCu4bdAVuUMNvqTMkg15nmCuWC13eGlhZtNywigKAQduXFDxvmKxG2RXZQV0v7HdQ/mVc7/PcmC8eEXdVM0132z8nDtoy99yyY7aUV9SX0rDHO77i3u858ePx+svOo1E/D/3Wv9CMQD/LcUV/1C43ZUHVoPdl0PqXM2Mx6usXHZNhjs9yfH8P+n5d7Pf3sEY5P4BJUHQhriLpzFXYFgxh6gMnSXrggQd+U3nWSeoET9J4fDHbPxbLeiTR/VL/fzyjNkSKli1b52IttGEwyvJF67HMTJmic8E3ahTdLnpOvD1FjYt+2z9s4CV1Byv9rmQV8VmlZvRYUCcLFb+ebbd/fbvgEM9/Ys+Nj2NsIYHCsIZt2A16vF9gO2j7BjWQ+z0+SuDcb92jNrzLzr+i55Ydz2EDsLL3YlSL+X4a9fO31IY5/qYsQBy07mHX329Z/9kf9vtr1M/PMOcXMKn8BXvfjmgqr8CHMTT1gVMIQeecc44kfa86J6oPnlabfZji98rf169hvlz7sNINiUHK/jH3G6fV1HBdVf34IQsq4vcjUfdYFLuvX8OkrAFb1LAY1MDw73tRdqhM0/22IMr2yY9fsv3xr2fP9fNcJeoEbkWB/iCjBgqjNCyHDcyHCYSW4sLBQgOuYdc96vEb1LAddKwGPWfYwLFs/cMaJdAJ0e2y/Y+D/sUE/sMG7st9fBbzWVhI4D/M52eU77/FfgaB1WQ9h+IeGqmkT67KFqHU1Jcjbzab7Zr5d9xxh57xjGe8Q9IrJG1Yze2KNJR/qPzV/Dnl8wDMqnvytnl3O1M+gZvvRmUTwPkJ5OT+jgej+8xBcLftd5yhiJWdYGXB3SiNnyIWANhz/TF8raSzSpaXese71ZXPw/Bo6/e88vfD5m6wyfekThc4q8xXUafYR6J8LJLdX41+p63HbflqtLzdZ+PzNrp9rA2xX1KncXJE+YWDR1q3j6iThX26pBcPWNaOj583Kiifw+KJ1vGZba1vVp1zNGsdN39+xhMgFmXAhmWfGf+3/y113h/7SQv+lrs/jZ5TjZ6bRuupDHhcktaVrH9miR73+150HPqJj3dRkD+sfg3sUZ4/qviCxUob5vtpOZcvM8r6+2W2Rl3/Yra53/YSQGFSxeOt5yU9cezYsbO3bt26SpuEQaY+cJKker2uWq3WntH54MGD2rt3709K+m5JF67y5h2V9Mv33HPPr23dulWbN2/WunXr2rNMF81M7fn3d9DzypZfyLLjwI5PPBN3o9FQrVa7W9LFJauwL7W6pA9Levvx48f/ftOmTUMd/2G2zW5L3cd52HVnWaYkSdrPfeqpp7R169YnJO3QcFnl+ccee2zdrl27CvcpSZKXSPpHty5fPCJEvxuS/uepU6fevGHDhp5tG2a//f2xUY71oOO30PM63q6FrL/sM7lcj4cQen4ajUb7dpZlyrKsfTuEoGaz2fO4PdbvcbstqWf9IQR90Rd90T51B55S/8CvUvJ4fDsOTMsC16LAedD6+93X7/Gi7S8KyId5/fjxYZYvuigw6PF+Fw6KlteA1/D73++5Uuf9L9oeqTsDXvT6/fZFbjlgXMX/P+2i4deEEP5pNTcM/RE4lUiS5Mskfbukb5C0Vd3dj6xR3VBvty9/XzzRme86NIympE9L+sPDhw//wc6dO9uBU9ww9Y1F/5i/32fZ/G2zmGBg3Nj+2T7ZcavX65qZmTktaf0Qq8kkfaDZbH5NmubtCFvParOgX+re1zRNf0954C91zkXfn9q6CNiX9Y81m823+H2yhvWjjz6q8847z3edMfGVMnv8e7Ms+921cg4BmEwWuEu9Fw6k/PvTP+YvCkjteR67HrPftv748fjCxKDlr7/++ue2NrUoWJZ6M9rx4zV1B4xxIGk9D/oFzYPWX/R4v4z7oIx3vwsXtn1F648f9/dXCtY/qEdH4u73P4nyXhr91r+UBrX5Dkt6UtKDkv7jtttu+5krr7xyiV8eS4nAaUjHjx/Xtm3bvkXSt0p6kfIPnNTppuTnu0ncY1J3dyHf2BymJHZd3d2ujkn6J0l/MD8//2FrNEu9V/L7BVNFjf9ms6k0TddMwORZQOGzTo8++qjOOuusYU/+pqQfDCH8zrgETJ7Pbth7nSTJiyR9pPWU+E0tCv4/kWXZ84vOkxMnTmjLli11dV8ciIMof///yrLsl9fiuQRgsi2mF4ZftnWBqu9jkgr/Vwx6/bKM9jAZ72H2b5iMeLx/ZcsXtSUX0xujbPuKHh/0/vjH+70/ceA8OzvbDnabzWbXT5yxLwqe/UXpNE1VqVS0bt06rV+/XjMzM9q0aVN7uUqlUnghG+OHwKmENUTtd7PZ1NGjR7Vr167XSHq5pK9Q5wpHvyvwfkxQGj02DJtjx6d0G8rHobxb0nvr9fq/V6vVwkyI/zAW7Y8PmPzjg744J0VRl8bWl9RzJX1iiFXY8X5xCOEj45qNi9/XVlfEzyuf3Dmei8mfR+379u/fn1xxxRVd6zNJkjwuabdbLp541wdivx1C+KFl2E0AGNoo3VoHPW8xr7+c/y9G3b9Bgcag5cfxf94wFrv9Ze3jsvXG73+8vqLge1KP9TSZ7FbxCrDgwk7mSqWinTt3KoTwRyGErzly5MiMpFdKeq86g+mlTrDkx4PY39LwQZNNUBo/vyppj6QflvSRWq12d5Ikv3bbbbf1dE+Igya7bftjDW7bX6mTgZp0ft+iq0yXarSqg6mtb5xYVxKp+/1t7eNfqBM0DTrvgiQ94xnP+EWp08XTrqq1PBItbxcKiuwadT8AYKlZV/V+39v+8UHP66do3KD/GaZhPehnqfdvmG0pWr7MqNs/7P4tRHz8F/M/u+j88D+jvFdF67M2Vtz+siwUxtPkt4xXgAUediL7zMW2bdsUQviz+fn5lz/xxBNbJP13Se9XXj3M+s5adTDrQzvM/EHGX9X32QJf7S5VXuTgf1xzzTWNWq12IE3TX77xxhu7AiHjszB2v43/Mb6QwiSz/ffvWetL6lINd/4nksLNN9/8z9LyfuEvhB+/Fb+Hn//8539G/ase+u6kFgR9k/XJl9TORLb29xH1BkpFxy9VXpQCACbGsA3/oob5qAHYMMsXZYdGDawW8vpFzyszKLAY9Pyl2p9+21K0L8MEdMNu16D3uyjbVLS++Hn2P3wtXLheq+iqV8KOT6vrUzvo6FdUwT4ER44c0a5du14l6VskPV/SJnWXtY4zUYP4blHxOso+XfdKes9nPvOZH3vWs57VVSCh8IWicU+T3t+231W/JEk+IulLhlxN/cSJEzObNm2SVNz9bzUVZRJdwPgJSTYAOe6mVzRg9flZln0i/sJP0/SPJX2HOoF6XKLd+3QI4YsWu18AsBiDGu72+Dh8hy/UYruSLbeyroCLWd9SrXM5t6Hf+VV0XBqNRru9tdrvGwYjpC1hJ74PmiQVBhQ+u7F9+3aFEN4RQviKgwcPblZe4ewTyudVkkar2uLfJ5svJx4v5ecOCu72BZJ+5LrrrmumaXp/kiRvq1QqLzh9Ot8MyzDYb6vUZ7cnnXU5kzr7ePDgQakTTAxjvw3itHWOyz9c2w4ftEdXtd6h7m568dg6Gy9nXhV3bWzt58MFy7U3I7r9tEXsEgAsibJMznJ/h5d1xRs1AxIbJWO1HPtV9viomaxR93fU7Rv2/Yj/Bw67DfE6ijJO8Trsvmq12pOJw3ia/JbxMvNdvPxJ7rtE+Q+ZD6zs5H/a056mZrP5+yGEF9x///0bJf0PSTdquOCp6NPjC0VY5qqi7oaxDeC3ACuVdJ6k10n6940bNz6cJMk7a7XaS0+ePKlqtdrVbc//nmRWrUbqBLt79+59vfIJjofpRJxJ+jcflAzqgrDSLIPov3AtGyZJjz322O8pn1DPB9Wxqrv/ZfV6vWg/H2399vPPZOpdX6ZWV71xOUYA4C204T7q+ssCm7IAYNRAaDm6vg3arqV+vKir30L2Zdj1l70nZce8KPvU7/2K74v3y9qUcTsM44fAqYSdvDbew/8dP6fogxJnb84991yFEN48Pz//RV/4whcSSb8gaX9rEQuE7LbUXfksRM+zMVTx8+12qt732FJle5UXtfjA5s2bjyRJ8p5qtfqtBw8eLOxvW8QmvCxSdMWmX//efl+KIXTPeVHE5uHw2+GLY/j7kyTRqVOnJOnHW3fZsfHjxaTugCD99Kc//UO2nnHMxhWdi3bfjh07pHzMXfwt7DNPdXd79/r16/9rQXD4mIqDryS6vyJp08mTJ/niBzCWhm1YL/X6l9tKZZxWyrjvy1KcI/H/bCvYhfE1Pq2/NcpXtPO/a7Wazj77bIUQ3thsNq+88cYbE0lvU95AlTqBku9mlSjvkmcBk80yXdT9SupfGMCzDMHLJP3p3r1755Ik+XiSJD+6f/9+pWkqXzBA6lwRSdO0cB4Ey4BI3VXt7Eui0Wh0XVXpd2UpSZKeUunxc2q1mhqNRtd2WMrbbts2hxC0adOmX5R0jrqDpaq7LXUyeg1J91xxxRWqVCpdcy3Yvo671jxff1XwkA/IbTIw26Fvlnr+KRwpWIcd9CT6rSeffHL0jQUAABhjFIdYAdbYL5p4Nu4HOzc3p/Xr13+ZpNdK+mpJW1Q8iL/rJdTpkhcHUcPqV6zi85I+Kul9x48f/+DmzZuVJEnh3FBF+zNoLNAw44R8N7Si5SV1BV72t7/Pxm1VKpWvl/Q36u6aZl0affbJlxR8YwjhF6ROsYxxGd80rNYEtgclnane4hC2IxY0pZJOPvroo5vPPPNMSflxPnDggK644oosen7RhZcgSZ/+9KfT5zznOcuxOwAAAKuCwGmZxWNjTFGXLx8kNJtNzc7OavPmzd+mvDLflynPDPjJcKW8oe/neRqlWp/UG2jFpdP94yclfUzSv3zuc59781VXXVVYWVDqBDN+jNGo3dzKgi57nWEm/U3T9OXKJwte1+/lWr/92LH6ww8/vGHPnj2qVqtdgdikBE+un/3vKw/G+1XTiwOh14QQ/tjWcfToUe3cudMHToOq6knSV4YQPrgkOwEAADAGCJyWmW9gx5kmqXdwf7/lH3zwQZ133nk/prwk9DPUe7V/oZmmYcRZGHutY5I+orzQxb8eO3bs41u3bpWknmAm3sdRA49+zx+0nizLdPz4ce3YseM3Jf2If0j58Ztv7ZcfJ+ZX9jshhO/r93qDyrqPk1aw9zxJ/65Ots0H3vF7K0n/2Ww2X2D7V6/XNTMzc1rSeve8JLrt7/vWEMK7l2F3AAAAVsX4t/omnG/Ux41sXwUtzkb5yXazLNPevXsVQnhzlmXP/NznPleR9BuS7lFnrI7PJEjdxSQG8YUQiopTZMob1pn727q3bZH0DZJ+TtJ/btu27VSSJDclSfL2SqXyLfv37+8qcz6oosww4mV8Ni8u3nDw4EFVKpXX79ix4351gqZ432bUmZPI2PF86p577vm+otczkxA0Se1z6BPKz5eYnxPMe+59993X/qM1VuxJFRchKbJ7IdsKAAAwrsg4rYCiMU1Fk6gWZTD6jYdqNBrKskzr1q37MknfJOnr1Gms+vEqwyjKVhWtw54XPxZnMHw1vyOS7pB0k/LqgZ+/6667/uXMM8/Uli1b+mbb7Ly0Lnc+UzU7O6vTp09rbm5Ohw4d0jXXXPPFysfvnC/p6ZKuk3SNOkUP4u23LEvc7dG6n2WSfiOE8OP2mnGRi0mZHNhvZ5IkPyPpTeo/xinumvnGLMt+wQX4n5V0rfpnmvyyvxJC+J/LuGsAAAArisBpBfiGty8S0a+oQlG3NmnwxKvHjh3T9u3bv17Sd0l6sfIuVWXjUIxvNEv9G8OWkaq4v+WW6dl1dQItG3flM1nzyrMYTeXBjGV+Kup0oasoD4DWKc8QVdQd7IRovfF4raJy7kVFNPyxevjYsWPnbNmypau4xKRkmGKWkXvwwQd14YUXxplIKyoi9b7/d2VZdpkLnP5F0peo//kh9/fvhRC+Z/n2CgAAYGUROE24er1uJafbjfvHH39cZ5555uskfaPyIKquTmEJ3zWrqJJcv4Bp0O2yqn+rrahght9/n2lKJX1VCOEDk1IAYhDLONm5kSTJf0h6nobPRn5xCOFjkpQkyV9I+u/qDZbibFWQ9HchhK9fqv0AAABYbZN5CR1tFjT5TNaePXsUQvi9LMu+7Iknnkgk/aCkD7cWsTFNNg+U77bm+e5rRXNE+cZzHJQMO75qJdTVnaGSOl307PGKu+9tIYQPNJvNiQ+aJLXLp1u3UEnv1GjzfL1Samc9D/d5TtGB2jHipgIAAIw1AqcJZxO7+m5+WZa179uxY4dCCL/baDS+4vHHH69K+j5J/6y8m1yiTqbJggfrWmfBj++WV9TQHpcAqZ+a8uDI2D5l7nG17vvo3Nzc90tqZ2kmXVwO/8iRI7+vvKy8NNzn/+uPHTtmx+JQ6z4fPPu/7b5E0tMWuekAAABjhcBpwvnCCVJe6c0q2PlMQ6VS0RlnnKEQwu+GEL7i0KFD6yR9j6T3KS8r7rtbWYYmnhzVj5dK1D9jMco8UsutqU5w5CMhy7hZ4/+TR44c+dKZmZmR55saZz6IDiFox44dkmTzKw3zHu3evn37t7YKTBxz98fdNOP1UVUPAACsKZPfMkRPie44C1U0Sey2bdsUQvi/jUbjZbOzs9uVV+X7XeUlq30BB6m3q5vxE++OU/c8z4I9q/YXB3xB0j8dO3bseTt27FCj0Wgfp7WQcbIgutFo+AD7T9Qpuz6M17Z+H1V3sFnEXmTz3NzcKJsKAAAw1gicJpxV4PO3LQvl5zayynDNZh4zWInqNE01MzOjEMI/hBBe32g0nn7rrbemkn5C0n8o79In9c7xFDe8+1XVGxe++IUvkPHz8/PzL926dauazaaq1Wp77qm1UDjFSqdXq9X2+XDy5Mn3K69mOKzn33XXXVJeWl7qrpDYL2tVffLJUV4CAABgvBE4TTifRfJlzn3GyYImC6rsPiuAkCSJ5ufz+KhSqeiqq65SCOHXms3mC5966ql1kr5U0q9IukHSaXWPjWpq/KvqSZ1MiQV8H7/xxhtrWZb9rBXYsONkx2gS5mkqY900pc5kzBs3bpSk9wy7CknrLr300l+SdEKDvzP8RMp69NFHR99gAACAMUU58gnn53jq97h/zE+Iao/Zff0m4/W3jx49qh07drxY0ldIul55aeuaeud2GqcgymdGPi7pF7Ms+0epeG6ssmM6aYre1yRJXijpIxr+4slB5RMtf1SdbFM8AXL8+0tDCB9dqv0AAABYTWScJpyfKLff457PothjcUZCKs5kSdL27dsVQviXEMJPhBC+tF6vb7jjjjuqkr5V0lsk/ae6iwiYTN3FGZZyTFS8bv8aknSnpF+4+eabk2az+V9CCP8YjwHzyo7pJLGsYjxea35+/t8k3WtPK1g0fm/OkvQydb4z/ITJRRMn2zIAAABrAhknLBkLRrIs0wMPPKALL7zwRZKeIek8SVdIukzS2ZI2qdO49kUbBlVpk3onsvVzTFlD/qikuyV9QtJnH3nkkXdu27bNuqd1ZV989m2tisuR+2xakiS/KunHW0+NJ7E1fnLkp5S/d6m6J1MumjRZkr4/hPC2pd8rAACAlUfghCUTd3mzbmFxsPLUU0/piSee0NGjR3X99de/TPlkqbslbZM0o7zr3zr3Yw36+dbPnPLxNieUdyE7Jumhxx577JN79uyRpK7qeD5jZuO/1kKp8YVqNBqqVqu69dZbdfXVV1swaooKPtjYsJo62amiiNOCL/MLIYQ3LtFmAwAArCoCJyzKMOOB+s2LVDTeqmjdcaBT9JqDtqMooFtL3fGG5TOCVhykWq3eJulydSZAjgMiHwzFmaX4+XHQ9X9DCK9bhl0BAABYcdN72R1LxgIQP4eUZ5PyGnu8aLxVCKFr0tYkSQqrBRaNS/Lrlronf/WP2dxGa2GepmHEQaUdz9bxf4d6C3vYbV8AokhRQRC/jl0L3WYAAIBxQ+CERbFxMxag2BxSdl9RRtOPtZF6gyULbOx+e068rizLuoIfC6jiAMmWj4OtaequFx9v+33PPfe8WVK99VC/yohWyt3/LXVKu/dL3e1Z1EYDAACMEbrqYVHijI4rd93zPKmT9fAT9y62FLgFXXGg1G9dg4KpaRCPOatWqx+R9CX+KeoEQ6N0z4u76t0dQrhkyXcAAABgFUzPJXcsCx94xBknSYUZJ6mTDepXCrxftkrqBEp+XXGmyzJX/nXidU9D0OQzcnbb73eru97fqpNVknoDISsgEdSdlYq79il6bMdS7AMAAMA4IOMETLFms6njx49r586dDeXBTlW91fEWbHZ2Nlm3bl1PZnIaglYAALC2kHECplilUtHmzZsl6R+UB002r5ZUPDHuSI4ePSpptK6XAAAA44jACZhiIQTVajVJ+uvWXRY8+W55C/bYY4/1dLksqoAIAAAw7uiqB0wx6zZ35MgRnXHGGcclbWk9VFc+4e1ifXmWZf88zPxaAAAA44yMEzDFLHDZuXOnJH3QPVRTd8GHhdrVLzgiaAIAAJOEwAmYcvPz83bz3a3fQZ1Keot1ptTbLY9MNwAAmDQETsCUm5mZUQhBx48ff5+kw8oDplSdiW4XY09RlzyyTQAAYNIQOAFQkiTasmWLlFfXs4BpKb4ftvu5pHymiawTAACYJAROwBSr1+uSpEajYXf9ifLvhaWKas5N096vGQpDAACASUPgBEyxWq2mEIKq1aqazaZmZ2f/WdJjWrrAaYcPkOw2QRMAAJg0BE7AFGs2m0qSRI1GQ5VKRdVqVZLeq/y7oTF46aE8zW7QNQ8AAEwyAidgiqVp2s44ZVmmVre6dyvPOFWX4CV22w0q6wEAgElG4ARMsSRJlCSJQghK01RJkqher39M0oNamu56m2ZnZ9uvBQAAMKkInIApZhXvkiRRs9mUJN9dbylUDx8+3H4NqZNpIpACAACThMAJmGI+eEnTVK50+F9oaSbA1aFDh7q65VmGCwAAYJIkNGAANJtNVSqVdpnwVte9L0i6aAlW/yWNRuNfK5VK+w7KkQMAgElDxgmYYtY9Lw5iWhdU/rL1p1XXa7qnZBre3kql0s5mETQBAIBJROAETDHLMtkktTbWKU1TfeYzn/mp1tOsup5FO5lG++7Yaev2vwEAACYJgRMw5SyQsYyQBVHPfvazJelO99SFfl+c6V9HohQ5AACYPAROwBRzxSAkdXejawU374kWaarzvTFs9LMnDpTIOgEAgElD4ARMsbiqXgihnQ0KIeimm276X+oez7SQiGdn0Z1knQAAwCQhcAKmWFwaPJ4Q9+qrr5akz7tFUuWZpqDhg6g9kroCMgAAgElD4ARMOcs6NZvNni50rfFOfxEtMkrQJElP810A6aYHAAAmEYETMMV89seKQlgAFUJQs9nUbbfd9ia/iEYf47Sj6PUIoAAAwCRhAlwAfWVZpjRNlSTJrZKu1MLGODXn5uaqMzMzS7x1AAAAK4eME4C+rGCEpL9u3RWi30Ot5sSJE113cMEGAABMGgInAKUOHDjwc+oUhRhFkJQcPnyYYAkAAEw0uuoB6MuKOmRZpkqlcrOkZ0iq2sMavuve87Ms+4SfI4oxTgAAYJKQcQLQly9NLumPlAdNNq9Tc8jVZJJ2+UCJoAkAAEwaAicAQ3nggQfeqjwISpRnm6qDl2gLknb13Em2GwAATBACJwB9+eDmnHPOkaR/VR44ZcVLFEolneHXRVc9AAAwaQicAPRVMCbJJsOtaLhCETYOagsZJgAAMMkInAD0lWVZ12S4x48f/31Jp1oPD5MySpSPhTrDJtglgAIAAJOIwAlAXzaPU5qmqlQq2rBhgyT9vfKuesN210skbWr/kSR00wMAABOHwAnAQD5DVK1WJekPlX93DPv9kUja7tdF1gkAAEwaAicAfblS5MqyPMF06tSpD0m6f8RVbbJ1hBAInAAAwMQhcALQl3Wpy7Ks3W2v1V3vT4dchRWHqNr6kiRpB2MAAACTgtYLgL4sM+THJIUQdPfdd/+0pPlRVmXBV7xuAACASUDgBKCvosBJki6++GJJ+schVmELnvR3Wrc/AACASUHgBKCvNE27ghzratdoNCTpt4ZYRWj9HI/LkVNZDwAATBICJwADFY1HqlarCiF8VNIN6kyEa799OimRVJf0YakTNDHGCQAATBpaLwAW46fUGetkKST/vZJJ+ut6vf5OqSdjBQAAMDEInAAsWAjhXyS9Q8UT4jYk/Wm9Xv+2SqUiSWo2m8qyzOaDAgAAmBgETgAWpdFofI+kH5R0qHVXJumEpP/daDS+o9WtTyEEVSoVpWmqer2uZrO5atsMAAAwqoSSwAAWKoTQLvJw+vRpbdy48QWSth05cuTvt2/f3lMAgsIQAABgUhE4AVi0ZrOpSqWi+fl5zczMtAMqq8iXpmk7w2Td9nzQBQAAMO4InAAsmAVMcRDUbDaVJEm7ep5NfkuwBAAAJhWBE4AlY2OZfLlx3z3PB04EUQAAYJIQOAEAAABACarqAQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJQgcAIAAACAEgROAAAAAFCCwAkAAAAAShA4AQAAAEAJAicAAAAAKEHgBAAAAAAlCJwAAAAAoASBEwAAAACUIHACAAAAgBIETgAAAABQgsAJAAAAAEoQOAEAAABACQInAAAAAChB4AQAAAAAJQicAAAAAKAEgRMAAAAAlCBwAgAAAIASBE4AAAAAUILACQAAAABKEDgBAAAAQAkCJwAAAAAoQeAEAAAAACUInAAAAACgBIETAAAAAJT4/wFdfyxCi58b6AAAAABJRU5ErkJggg=='


const FOOTER = (left: string, page: number, total: number) => `
<div class="runfoot">
  <div class="legal"><b>Voltis Soluciones S.L.</b> · CIF B71548705<br/>C/ Berriobide 38, Of. 209 · Ansoáin (Navarra)</div>
  <div class="pageno">0${page}<em> / 0${total}</em></div>
  <div class="contact">voltisenergia.com<br/>clientes@voltisenergia.com · 747 474 360</div>
</div>`

const RUNHEAD = (right: string, anchor?: string) => `
<div class="runhead">
  <div class="left">
    <span class="brand"><span class="brand-mark"></span>Voltis Energía</span>
    ${anchor ? `<span style="opacity:.5">·</span><span class="anchor">${anchor}</span>` : ''}
  </div>
  <div class="right">${right}</div>
</div>`

function fmtCurrency(n: number) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function addMonths(d: Date, m: number) {
  const r = new Date(d); r.setMonth(r.getMonth() + m); return r
}

// ─── PROPUESTA (4 páginas) ────────────────────────────────────────────────────

export interface PropuestaData {
  clientName: string
  clientType?: string   // 'ayuntamiento' | 'empresa' | 'particular' | 'autonomo'
  representativeName: string
  ahorroConfirmado: number | null
  feeAmount: number
  subscriptionQuarterly?: number  // cuota trimestral sin IVA (para tipo suscripcion)
  startDate: Date
  endDate: Date
  contractType: 'porcentaje' | 'suscripcion'
  year?: number
}

/** Devuelve las etiquetas contextuales según el tipo de cliente */
function entityLabels(clientType: string | undefined, clientName: string) {
  const isAyto = clientType === 'ayuntamiento'
  const isNatural = clientType === 'particular' || clientType === 'autonomo'
  return {
    // "colaboración entre Voltis Energía y X"
    nombreDirecto: `<strong>${clientName}</strong>`,
    // "de la empresa" / "del ayuntamiento" / "del cliente"
    genitivo: isAyto ? 'del ayuntamiento' : isNatural ? 'del cliente' : 'de la empresa',
    // "en su empresa" / "en el ayuntamiento" / "en su actividad"
    enEntidad: isAyto ? `en ${clientName}` : isNatural ? 'en su actividad profesional' : 'en su empresa',
    // "equipo de la empresa" / "equipo del ayuntamiento" / "equipo del cliente"
    equipo: isAyto ? 'equipo del ayuntamiento' : isNatural ? 'equipo del cliente' : 'equipo de la empresa',
    // "facturación de energía de la empresa" / "del ayuntamiento" / "del cliente"
    facturacion: isAyto ? `facturación de energía del ayuntamiento` : isNatural ? 'facturación de energía del cliente' : 'facturación de energía de la empresa',
  }
}

export function generatePropuestaHTML(d: PropuestaData): string {
  const year = d.year ?? new Date().getFullYear()
  const endDateStr = fmtDateLong(d.endDate)
  const lbl = entityLabels(d.clientType, d.clientName)
  const ahorroStr = d.ahorroConfirmado ? fmtCurrency(d.ahorroConfirmado) : '—'
  const subQ = d.subscriptionQuarterly ?? 0
  const minutaStr = d.contractType === 'porcentaje'
    ? `${fmtCurrency(d.feeAmount)} € + IVA`
    : `${fmtCurrency(subQ)}/trimestre + IVA`

  const page1 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year} · v1.0`)}
      <div class="cover">
        <div class="cover-eyebrow">Propuesta de colaboración</div>
        <h1>Asesoría energética<br/><em>integral</em></h1>
        <p class="cover-sub">Una propuesta a medida para optimizar el coste energético y dar el primer paso hacia un <strong>Sistema de Gestión Energética</strong>.</p>
        <div class="cover-rule"></div>
        <div class="section-title">Dirigida a</div>
        <div class="party-grid">
          <div class="party">
            <div class="party-tag">Cliente<span class="role">Razón social</span></div>
            <div class="party-body"><strong>${d.clientName}</strong></div>
          </div>
        </div>
        <p style="margin-top:8mm;font-size:11pt;line-height:1.6;color:var(--ink-2)">Apreciado/a <strong>${d.representativeName || d.clientName}</strong>,</p>
        <p style="margin-top:3mm;font-size:11pt;line-height:1.6;color:var(--ink-2)">En relación con nuestra última reunión, le adjunto a continuación el detalle de la propuesta de colaboración entre <strong>Voltis Energía</strong> y ${lbl.nombreDirecto}.</p>
        <div style="margin-top:8mm">
          <div class="section-title">Objetivo del estudio</div>
          <div class="fees">
            <div>
              <div class="label">Ahorro estimado</div>
              <div class="desc">El presente estudio significará, con total seguridad, un ahorro aproximado en el cómputo total de la ${lbl.facturacion}.</div>
            </div>
            <div class="figure"><strong>${d.ahorroConfirmado ? fmtCurrency(d.ahorroConfirmado) : '—'}</strong><span class="pct">€/año</span></div>
          </div>
          <p style="font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-top:3mm">Además, este estudio resulta <strong>imprescindible</strong> como punto de partida para la implantación futura de un <em>Sistema de Gestión Energética (SGE)</em>. A continuación se detalla el alcance del estudio y las áreas de trabajo concretas.</p>
        </div>
      </div>
      ${FOOTER('', 1, 4)}
    </div>
  </article>`

  const page2 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>01</em></div></div>
          <div class="clause-body" style="font-size:10pt">
            <h2>Revisión energética</h2>
            <p style="font-size:10pt;margin-bottom:2mm">Estado actual de los suministros eléctricos de <strong>${d.clientName}</strong>.</p>
            <div style="display:flex;flex-direction:column;gap:2mm;margin-top:2mm">
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">A · Optimización de las potencias contratadas</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Ajuste de las potencias contratadas en cada suministro eléctrico en función de las potencias realmente demandadas por las instalaciones e infraestructuras del cliente.</p>
                <ul class="cb-list" style="margin-top:1.5mm"><li><span class="li-body">Tarifas <strong>.TD</strong> · revisión de las demandas reales registradas por los contadores eléctricos a través de la página de la distribuidora, ajustadas mediante nuestro software especializado.</span></li></ul>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">B · Mejora del desempeño energético</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Identificación de oportunidades para la mejora del desempeño energético y de posibles desviaciones de consumo, teniendo en cuenta el patrón habitual en función del uso y comparando con suministros de características similares.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">C · Revisión de tarifas de acceso</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Comprobación de que las tarifas de acceso son las apropiadas en cada caso, atendiendo a los consumos reales. Se incluye propuesta de eliminación de posibles penalizaciones detectadas, especialmente en <em>energía reactiva</em>.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">D · Condiciones económicas y estrategia de compra</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Revisión de las condiciones económicas del suministro y, si procede, definición de una estrategia de compra de energía para los próximos meses.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">E · Áreas de uso significativo de energía</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Identificación de las áreas de uso significativo de energía y de consumo, para valorar su posterior medición y control:</p>
                <div class="oblig-grid" style="margin-top:2mm">
                  <div class="oblig-col"><h3>Sustitución de contadores</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuesto para la sustitución de contadores eléctricos en régimen de alquiler por contadores de altas prestaciones en propiedad.</p></div>
                  <div class="oblig-col"><h3>Medidores específicos</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuesto para la instalación de medidores en edificios, plantas fotovoltaicas, líneas o máquinas concretas.</p></div>
                </div>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">F · Reuniones semestrales</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Reuniones semestrales con los miembros responsables de la planificación energética, con el objetivo de recabar las aportaciones derivadas de la observación directa del entorno y de los procesos del día a día.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">G · Verificación de KPIs económicos</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Reunión semestral para verificar que los KPIs económicos se estén cumpliendo según lo estipulado.</p>
              </div>
              <div>
                <h3 style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:1.5mm">H · Revisión de suministros y empleados</h3>
                <p style="margin:0;font-size:9.5pt;line-height:1.45;color:var(--ink-2)">Revisión de hasta <strong>10 suministros</strong> y contrataciones de los empleados de <strong>${d.clientName}</strong>.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
      ${FOOTER('', 2, 4)}
    </div>
  </article>`

  const page3 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>02</em></div></div>
          <div class="clause-body">
            <h2>Revisión de propuestas de terceros</h2>
            <p>Análisis y revisión de las propuestas hechas por terceros a <strong>${d.clientName}</strong> en materia de mejoras de eficiencia energética: instalaciones de techos solares, tecnología <strong>LED</strong>, sistemas de gestión energética, y cualquier otra iniciativa relacionada con el ahorro y la eficiencia.</p>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>03</em></div></div>
          <div class="clause-body">
            <h2>Duración del contrato y honorarios</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:1mm">
              <div class="pay-row" style="margin:0">
                <div class="top" style="grid-template-columns:1fr;gap:2mm">
                  <div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)">Duración del contrato</div>
                  <div class="amt" style="font-family:var(--serif);font-size:13pt;white-space:normal;line-height:1.3">Hasta el ${endDateStr}</div>
                </div>
                <div style="font-size:9.5pt;color:var(--ink-3);line-height:1.45">Vigencia desde la firma de la propuesta por parte del cliente. La forma de pago y las condiciones quedan recogidas en el contrato adjunto.</div>
              </div>
              <div class="fees" style="margin:0;padding:5mm 6mm;display:flex;flex-direction:column;gap:3mm;align-items:flex-start;border-radius:5px">
                <div>
                  <div class="label">Minuta anual</div>
                  <div class="desc" style="font-size:9.5pt;margin-top:1mm">Honorarios anuales por los servicios profesionales descritos. Aplicables desde el momento en que se reciba la propuesta firmada.</div>
                </div>
                <div class="figure" style="font-size:22pt;line-height:1.1">${minutaStr}</div>
              </div>
            </div>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Punto</div><div class="ord"><em>04</em></div></div>
          <div class="clause-body">
            <h2>Otros servicios complementarios</h2>
            <p>Le ponemos en su conocimiento otros aspectos en los que puede contar con nosotros siempre que lo estime oportuno:</p>
            <div class="oblig-grid" style="margin-top:2mm">
              <div class="oblig-col"><h3>Gestión energética avanzada</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Ayuda y soporte en la gestión energética de las instalaciones y equipamientos consumidores de energía.</p></div>
              <div class="oblig-col"><h3>Energías renovables</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Presupuestos y análisis de proyectos de implantación de energías renovables en las instalaciones.</p></div>
              <div class="oblig-col" style="margin-top:3mm"><h3>Normativa y certificaciones</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Implantación de normativa energética: auditorías y certificación energética de edificios.</p></div>
              <div class="oblig-col" style="margin-top:3mm"><h3>Captación de fondos</h3><p style="margin:0;font-size:9pt;color:var(--ink-2);line-height:1.4">Ayuda y soporte para la captación de fondos destinados a proyectos e inversiones en eficiencia energética.</p></div>
            </div>
          </div>
        </section>
      </div>
      ${FOOTER('', 3, 4)}
    </div>
  </article>`

  const page4 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`PRC-${year}`, 'Propuesta de colaboración')}
      <div class="cover" style="flex:none">
        <div class="cover-eyebrow" style="margin-bottom:8mm">A su disposición</div>
        <h1 style="font-size:30pt">Quedamos a<br/>su <em>disposición</em></h1>
        <p class="cover-sub" style="margin-top:6mm">Estaremos encantados de resolver cualquier duda que pudiera surgirle sobre el alcance de esta propuesta o sobre cómo implementarla ${lbl.enEntidad}. No dude en contactar con nosotros a través de cualquiera de los canales habituales.</p>
        <div style="margin-top:10mm;display:grid;grid-template-columns:repeat(3,1fr);gap:6mm">
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Email</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">clientes@voltisenergia.com</div></div>
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Teléfono</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">747 474 360</div></div>
          <div class="pay-row" style="margin:0"><div class="label" style="font-family:var(--mono);font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2mm">Web</div><div style="font-family:var(--serif);font-size:13pt;color:var(--ink)">voltisenergia.com</div></div>
        </div>
      </div>
      <div style="margin-top:14mm">
        <div class="section-title">Aceptación de la propuesta</div>
        <p style="font-size:10.5pt;line-height:1.5;color:var(--ink-2);margin-bottom:6mm">Conforme con el alcance, condiciones y honorarios descritos en esta propuesta, ambas partes firman a continuación.</p>
        <div class="sigs">
          <div class="sig">
            <div class="role">El Cliente</div>
            <div class="box">Firma y sello</div>
            <div class="name" style="border-bottom:.5pt solid var(--ink-3);min-height:1.2em;margin-bottom:3mm"></div>
            <div class="id">D./Dña. ${d.representativeName || '____________________________'}</div>
          </div>
          <div class="sig">
            <div class="role">El Asesor</div>
            <div style="height:18mm;display:flex;align-items:center;justify-content:center"><img src="${FIRMA_NICOLAS}" style="max-height:16mm;max-width:52mm;object-fit:contain" /></div>
            <div class="name">Voltis Soluciones S.L.</div>
            <div class="id">D. Nicolás Imízcoz García</div>
          </div>
        </div>
      </div>
      ${FOOTER('', 4, 4)}
    </div>
  </article>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Propuesta de colaboración — ${d.clientName}</title>${GOOGLE_FONTS}<style>${BASE_CSS}</style></head><body><div class="viewer">${page1}${page2}${page3}${page4}</div></body></html>`
}

// ─── CONTRATO (6 páginas) ─────────────────────────────────────────────────────

export interface PaymentScheduleItem { label: string; date: Date; amount: number }

export interface ContratoData {
  clientName: string
  clientType?: string   // 'ayuntamiento' | 'empresa' | 'particular' | 'autonomo'
  clientCif: string
  clientFiscalAddress: string
  representativeName: string
  representativeNif: string
  signingLocation: string
  startDate: Date
  endDate: Date
  firstPaymentDate: Date
  ahorroConfirmado: number | null
  feeAmount: number
  subscriptionQuarterly?: number  // cuota trimestral sin IVA (para tipo suscripcion)
  contractType: 'porcentaje' | 'suscripcion'
  paymentModality: 'A' | 'B' | 'C' | 'D'
  paymentSchedule: PaymentScheduleItem[]
  isNatural?: boolean   // true para particular/autónomo → sin "en nombre y representación de"
  year?: number
}

function buildClausulaV(d: ContratoData): string {
  const iban = 'ES19&nbsp;&nbsp;0182&nbsp;&nbsp;5000&nbsp;&nbsp;8402&nbsp;&nbsp;0187&nbsp;&nbsp;5295'
  const fmtItem = (item: PaymentScheduleItem) => `
    <div class="pay-row">
      <div class="top">
        <div class="desc"><strong>${item.label}</strong> — al ${fmtDateLong(item.date)}</div>
        <div class="amt">${fmtCurrency(item.amount)}<span class="vat"> + IVA</span></div>
      </div>
    </div>`

  switch (d.paymentModality) {
    case 'A': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en la cláusula anterior de la forma siguiente:</p>
      <div class="pay-row">
        <div class="top">
          <div class="desc">Pago único mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</div>
          <div class="amt">${fmtCurrency(d.feeAmount)}<span class="vat"> + IVA</span></div>
        </div>
        <div><span class="iban">${iban}</span></div>
      </div>
      <ul class="cb-list"><li><span class="li-body">Se facilitará una factura anualmente por parte del <strong>Asesor</strong> hacia el <strong>Cliente</strong> para hacer efectivo el ingreso por los servicios prestados.</span></li></ul>
      <div class="callout">
        <div class="label">Regularización al cierre del periodo anual</div>
        <div class="row"><span class="tag up">+ Ahorro</span><span>Si el ahorro real obtenido <strong>supera</strong> el estimado, el <strong>Asesor</strong> podrá emitir factura al <strong>Cliente</strong> por el <strong>25%</strong> de la diferencia positiva.</span></div>
        <div class="row"><span class="tag down">– Ahorro</span><span>Si el ahorro real obtenido es <strong>inferior</strong> al estimado, el <strong>Cliente</strong> podrá solicitar la regularización. El <strong>Asesor</strong> emitirá factura rectificativa ajustando los honorarios.</span></div>
      </div>`

    case 'B': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en cuatro (4) cuotas trimestrales iguales, abonadas al vencimiento de cada trimestre, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div style="margin:2mm 0 3mm"><span class="iban">${iban}</span></div>
      ${d.paymentSchedule.map(fmtItem).join('')}`

    case 'C': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada de la siguiente forma: el 50% a la firma del contrato y el resto en cuatro (4) cuotas trimestrales, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div style="margin:2mm 0 3mm"><span class="iban">${iban}</span></div>
      ${d.paymentSchedule.map(fmtItem).join('')}`

    case 'D': return `
      <p>El <strong>Cliente</strong> hará efectiva la cantidad estipulada en un único pago al vencimiento del contrato, mediante transferencia bancaria a la cuenta corriente de la entidad <strong>BBVA</strong>.</p>
      <div class="pay-row">
        <div class="top">
          <div class="desc">Pago único al vencimiento — ${fmtDateLong(d.paymentSchedule[0]?.date ?? d.endDate)}<br/><span class="iban" style="margin-top:2mm;display:inline-block">${iban}</span></div>
          <div class="amt">${fmtCurrency(d.feeAmount)}<span class="vat"> + IVA</span></div>
        </div>
      </div>`
  }
}

export function generateContratoHTML(d: ContratoData): string {
  const year = d.year ?? new Date().getFullYear()
  const today = new Date()
  const todayStr = fmtDateLong(today)
  const startStr = fmtDateLong(d.startDate)
  const lbl = entityLabels(d.clientType, d.clientName)
  const firstPayStr = fmtDateLong(d.firstPaymentDate)
  const anchor = 'Contrato de prestación de servicios profesionales'

  const page1 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year} · v1.0`)}
      <div class="cover">
        <div class="cover-eyebrow">Contrato profesional</div>
        <h1>Contrato de prestación<br/>de servicios <em>profesionales</em></h1>
        <p class="cover-sub">Servicios de asesoría y consultoría energética prestados por <strong>Voltis Soluciones&nbsp;S.L.</strong></p>
        <div class="cover-rule"></div>
        <div class="section-title">Reunidos</div>
        <div class="party-grid">
          <div class="party">
            <div class="party-tag">De una parte<span class="role">El cliente</span></div>
            <div class="party-body">${d.isNatural
  ? `Don/Doña <strong>${d.representativeName}</strong>, mayor de edad, con ${idDocLabel(d.representativeNif)} <strong>${d.representativeNif || '___________'}</strong>, en representación propia y domicilio en <strong>${d.clientFiscalAddress || '________________________________'}</strong> <span class="alias">(en adelante «el Cliente»).</span>`
  : `Don/Doña <strong>${d.representativeName}</strong>, mayor de edad, con ${idDocLabel(d.representativeNif)} <strong>${d.representativeNif || '___________'}</strong>, en nombre y representación de <strong>${d.clientName}</strong>, con CIF <strong>${d.clientCif || '___________'}</strong> y domicilio en <strong>${d.clientFiscalAddress || '________________________________'}</strong> <span class="alias">(en adelante «el Cliente»).</span>`
}</div>
          </div>
          <div class="party">
            <div class="party-tag">De otra parte<span class="role">El asesor</span></div>
            <div class="party-body">Don <strong>Nicolás Imízcoz García</strong>, mayor de edad, con DNI <strong>73464830R</strong>, en nombre y representación de <strong>Voltis Soluciones S.L.</strong>, con CIF <strong>B71548705</strong> y domicilio en Calle Berriobide&nbsp;38, Of.&nbsp;209, Ansoáin (Navarra)&nbsp;31013 <span class="alias">(en adelante «el Asesor»).</span></div>
          </div>
        </div>
        <div class="cover-meta">
          <div class="field"><div class="label">Lugar de formalización</div><div class="value">${d.signingLocation || '________________________'}</div></div>
          <div class="field"><div class="label">Fecha</div><div class="value">${todayStr}</div></div>
        </div>
      </div>
      ${FOOTER('', 1, 6)}
    </div>
  </article>`

  const page2 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="section-title">Exponen</div>
      <div class="expone-list">
        <div class="expone-item"><span class="ord">Primero.</span><p>Que el <strong>Asesor</strong> está especializado en la prestación de servicios de asesoría y consultoría energética.</p></div>
        <div class="expone-item"><span class="ord">Segundo.</span><p>Que el <strong>Cliente</strong> requiere sus servicios profesionales, que serán concretados en la estipulación <strong>Primera</strong> de este contrato.</p></div>
      </div>
      <p class="bridge">Ambas partes se reconocen mutuamente suficiente capacidad jurídica y de obrar para el otorgamiento del presente contrato, a cuyo efecto acuerdan las siguientes <em>cláusulas</em>.</p>
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>I</em></div></div>
          <div class="clause-body">
            <h2>Objeto del contrato y funciones a desarrollar</h2>
            <p>El <strong>Asesor</strong> se compromete a prestar auxilio y consejo al <strong>Cliente</strong> en las materias siguientes:</p>
            <ul class="cb-list"><li><span class="li-body">Todo lo referido en la <em>«Propuesta de colaboración Voltis Energía — ${d.clientName}»</em>, presentada y aceptada el ${startStr}, la cual se incluye como <strong>Anexo&nbsp;I</strong>.</span></li></ul>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>II</em></div></div>
          <div class="clause-body"><h2>Duración del contrato</h2><p>Las partes acuerdan que el contrato tendrá una duración de <strong>doce&nbsp;(12) meses</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>III</em></div></div>
          <div class="clause-body"><h2>Fecha de inicio de los servicios</h2><p>La fecha de inicio de los servicios prestados por el <strong>Asesor</strong> comenzó el día <strong>${startStr}</strong>, y su consiguiente pago será el día <strong>${firstPayStr}</strong>.</p></div>
        </section>
      </div>
      ${FOOTER('', 2, 6)}
    </div>
  </article>`

  const subQC = d.subscriptionQuarterly ?? 0
  const honorariosDesc = d.contractType === 'porcentaje'
    ? `<p>Tomando como referencia el ahorro estimado recogido en la <em>«Propuesta de colaboración Voltis Energía — ${d.clientName}»</em> (Anexo&nbsp;I), los honorarios correspondientes al primer año de servicio ascienden a <strong>${fmtCurrency(d.feeAmount)} más IVA</strong>, importe equivalente al <strong>25%</strong> del ahorro estimado.</p><p>Este importe será facturado al <strong>Cliente</strong> conforme a lo establecido en la cláusula <strong>Quinta</strong> del presente contrato, quedando sujeto a regularización al finalizar el periodo anual en función del ahorro real obtenido.</p>`
    : `<p>Los honorarios por el servicio de suscripción ascienden a <strong>${fmtCurrency(subQC)} € más IVA trimestrales</strong>, lo que representa <strong>${fmtCurrency(subQC * 4)} más IVA</strong> anuales, facturados conforme a la cláusula <strong>Quinta</strong>.</p>`

  const page3 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>IV</em></div></div>
          <div class="clause-body">
            <h2>Honorarios</h2>
            <div class="fees">
              <div>
                <div class="label">${d.contractType === 'porcentaje' ? 'Porcentaje sobre ahorro' : 'Cuota trimestral fija'}</div>
                <div class="desc">Del ahorro económico anual obtenido por el <strong>Cliente</strong> como consecuencia de los servicios de asesoría energética prestados.</div>
              </div>
              <div class="figure">${d.contractType === 'porcentaje' ? '<strong>25</strong><span class="pct">%</span>' : `<strong>${fmtCurrency(subQC)}</strong><span class="pct">€/trim</span>`}</div>
            </div>
            ${honorariosDesc}
            <p>En caso de prórroga del contrato, las partes podrán acordar la revisión de los honorarios con una antelación mínima de un&nbsp;(1)&nbsp;mes respecto a la finalización del periodo contractual.</p>
          </div>
        </section>
      </div>
      ${FOOTER('', 3, 6)}
    </div>
  </article>`

  const page4 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>V</em></div></div>
          <div class="clause-body">
            <h2>Forma de pago</h2>
            ${buildClausulaV(d)}
          </div>
        </section>
      </div>
      ${FOOTER('', 4, 6)}
    </div>
  </article>`

  const page5 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VI</em></div></div>
          <div class="clause-body">
            <h2>Obligaciones de las partes</h2>
            <div class="oblig-grid">
              <div class="oblig-col"><h3>Obligaciones del Asesor</h3><ul class="cb-list"><li><span class="li-body">Prestar sus servicios de forma diligente.</span></li><li><span class="li-body">Presentar los documentos correspondientes en tiempo y forma ante el ${lbl.equipo}.</span></li><li><span class="li-body">Asesorar e informar periódicamente al <strong>Cliente</strong> de todos aquellos aspectos relacionados con sus asuntos.</span></li></ul></div>
              <div class="oblig-col"><h3>Obligaciones del Cliente</h3><ul class="cb-list"><li><span class="li-body">Presentar los documentos que correspondan para la correcta prestación del servicio.</span></li><li><span class="li-body">Asistir a las reuniones y visitas necesarias para el asesoramiento.</span></li><li><span class="li-body">El pago de los servicios prestados con las condiciones acordadas en las cláusulas <strong>Cuarta</strong> y <strong>Quinta</strong> de este contrato.</span></li></ul></div>
            </div>
          </div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VII</em></div></div>
          <div class="clause-body"><h2>Información periódica al Cliente</h2><p>El <strong>Asesor</strong> y el <strong>Cliente</strong> se comprometen a mantener un mínimo de <strong>dos&nbsp;(2) reuniones anuales</strong> con el objeto de informarse mutuamente o de entregar los documentos que procedan para la prestación de los servicios por parte del <strong>Asesor</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>VIII</em></div></div>
          <div class="clause-body">
            <h2>Resolución del contrato</h2>
            <p>El presente contrato podrá ser resuelto:</p>
            <ul class="cb-list">
              <li><span class="li-body">Por <strong>acuerdo de las partes</strong>, mediante notificación fehaciente por escrito a la otra parte, y siempre que medie un preaviso mínimo de <strong>un&nbsp;(1) mes</strong>.</span></li>
              <li><span class="li-body">De forma <strong>unilateral</strong>, cuando concurra alguna de las siguientes causas:<ul class="cb-sub"><li><span class="li-body">Incumplimiento de las obligaciones especificadas en el contrato.</span></li><li><span class="li-body">Declaración de situación de concurso del <strong>Cliente</strong> o del <strong>Asesor</strong>, o situaciones análogas que impliquen el fin de la relación contractual.</span></li></ul></span></li>
            </ul>
          </div>
        </section>
      </div>
      ${FOOTER('', 5, 6)}
    </div>
  </article>`

  const page6 = `
  <article class="page">
    <div class="page-body">
      ${RUNHEAD(`CSP-${year}`, anchor)}
      <div class="clauses">
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>IX</em></div></div>
          <div class="clause-body"><h2>Protección de datos</h2><p>El <strong>Cliente</strong> se muestra conforme con la inclusión de sus datos personales en los ficheros del <strong>Asesor</strong>.</p><p>El <strong>Cliente</strong> puede solicitar en cualquier momento el acceso, rectificación, cancelación u oposición de sus datos al <strong>Asesor</strong>.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>X</em></div></div>
          <div class="clause-body"><h2>Confidencialidad</h2><p>El <strong>Asesor</strong> se compromete a mantener la confidencialidad acerca de los datos e informaciones que el <strong>Cliente</strong> le haya facilitado para la ejecución de los servicios de asesoría encomendados, salvo que deban ser divulgadas por imperativo legal.</p></div>
        </section>
        <section class="clause">
          <div class="clause-num"><div class="kicker">Cláusula</div><div class="ord"><em>XI</em></div></div>
          <div class="clause-body"><h2>Sumisión a tribunales</h2><p>Las partes acuerdan que para las discrepancias que pudieran surgir en la interpretación, ejecución o aplicación de esta hoja de encargo, se someten expresamente a los <strong>Juzgados y Tribunales de Pamplona</strong> y renuncian de forma expresa a cualquier otro fuero o jurisdicción que pudiera serles de aplicación.</p></div>
        </section>
      </div>
      <div style="margin-top:6mm">
        <div class="signing-intro">— En prueba de conformidad —</div>
        <p class="signing-sub">Los comparecientes firman, en el lugar y fecha que figuran en el encabezamiento del presente contrato.</p>
        <div class="sigs">
          <div class="sig">
            <div class="role">El Cliente</div>
            <div class="box">Firma y sello</div>
            <div class="name" style="border-bottom:.5pt solid var(--ink-3);min-height:1.2em;margin-bottom:3mm"></div>
            <div class="id">D./Dña. ${d.representativeName || '____________________________'}</div>
          </div>
          <div class="sig">
            <div class="role">El Asesor</div>
            <div style="height:18mm;display:flex;align-items:center;justify-content:center"><img src="${FIRMA_NICOLAS}" style="max-height:16mm;max-width:52mm;object-fit:contain" /></div>
            <div class="name">Voltis Soluciones S.L.</div>
            <div class="id">D. Nicolás Imízcoz García</div>
          </div>
        </div>
      </div>
      ${FOOTER('', 6, 6)}
    </div>
  </article>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Contrato de servicios — ${d.clientName}</title>${GOOGLE_FONTS}<style>${BASE_CSS}</style></head><body><div class="viewer">${page1}${page2}${page3}${page4}${page5}${page6}</div></body></html>`
}

/** Abre el HTML en una nueva ventana lista para imprimir como PDF */
export function openInNewWindow(html: string) {
  const w = window.open('', '_blank')
  if (!w) { alert('Activa las ventanas emergentes para este sitio'); return }
  w.document.write(html)
  w.document.close()
}

/**
 * Abre el contrato/propuesta en nueva ventana y lanza el diálogo de impresión
 * automáticamente (el navegador permite guardar como PDF sin pasos adicionales).
 * Devuelve un Blob HTML para subir a Supabase.
 */
export async function generateAndDownloadPDF(html: string, _filename: string): Promise<Blob> {
  // Inyectamos un script al final del <body> que dispara print() cuando las
  // fuentes están cargadas, con un pequeño delay de seguridad.
  const htmlWithAutoPrint = html.replace(
    '</body>',
    `<script>
      (function() {
        function doPrint() {
          window.focus();
          window.print();
        }
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() { setTimeout(doPrint, 400); });
        } else {
          window.onload = function() { setTimeout(doPrint, 600); };
        }
      })();
    <\/script></body>`
  )

  // Abrimos la ventana con el HTML completo (fuentes, estilos, firma incluida)
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(htmlWithAutoPrint)
    w.document.close()
  } else {
    alert('Activa las ventanas emergentes para este sitio y vuelve a intentarlo.')
  }

  // Devolvemos el HTML como Blob para guardarlo en Supabase
  return new Blob([html], { type: 'text/html' })
}

/**
 * Escribe HTML con auto-print en una ventana ya abierta.
 * Usar cuando se necesita abrir varias ventanas desde un mismo click
 * (los navegadores bloquean window.open() dentro de setTimeout/await).
 */
export function writePDFToWindow(w: Window, html: string): void {
  const htmlWithAutoPrint = html.replace(
    '</body>',
    `<script>
      (function() {
        function doPrint() { window.focus(); window.print(); }
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() { setTimeout(doPrint, 400); });
        } else {
          window.onload = function() { setTimeout(doPrint, 600); };
        }
      })();
    <\/script></body>`
  )
  w.document.write(htmlWithAutoPrint)
  w.document.close()
}
