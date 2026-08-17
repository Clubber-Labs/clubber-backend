// HTML 100% em tabelas com estilos inline: é o único formato que renderiza
// consistente em Gmail, Outlook (mso), Apple Mail e afins.
// Base clara de propósito: o dark mode do Gmail transforma cores à força (sem
// opt-out) e inverte e-mails escuros; um e-mail claro só é escurecido com graça.

const ASSETS_BASE_URL = 'https://assets.clubber.social/'

type PasswordResetEmailParams = {
  /** Primeiro nome de quem recebe. */
  name: string
  /** Código de verificação de 6 dígitos, ex. "697567". */
  code: string
  /** Validade do código em minutos. */
  expiresInMinutes: number
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function passwordResetSubject(code: string) {
  return `${code} é o seu código de recuperação — Clubber`
}

export function passwordResetText({
  name,
  code,
  expiresInMinutes,
}: PasswordResetEmailParams) {
  return [
    `Oi, ${name} — recebemos um pedido para redefinir a senha da conta ligada a este e-mail.`,
    '',
    `Seu código: ${code}`,
    '',
    `O código vale por ${expiresInMinutes} minutos e só pode ser usado uma vez. Digite-o na tela de recuperação do app — nunca compartilhe com ninguém.`,
    '',
    'Não foi você? Pode ignorar este e-mail — o código expira sozinho e sua senha continua a mesma.',
    '',
    'Clubber · clubber.social',
  ].join('\n')
}

export function passwordResetHtml({
  name,
  code,
  expiresInMinutes,
}: PasswordResetEmailParams) {
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Seu código de recuperação — Clubber</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F4F4F5; -webkit-text-size-adjust:100%;">
  <!-- preheader (invisível, aparece ao lado do assunto) -->
  <span style="display:none; font-size:1px; color:#F4F4F5; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">Seu código de recuperação é ${code} — vale por ${expiresInMinutes} minutos.&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</span>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
    <tr>
      <td align="center" style="padding:32px 12px 48px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px; max-width:600px;">

          <!-- header: wordmark -->
          <tr>
            <td align="center" style="padding:8px 0 24px;">
              <img src="${ASSETS_BASE_URL}sticker-wordmark.png" width="170" height="75" alt="clubber" style="display:block; width:170px; height:75px; border:0; font-family:Arial, Helvetica, sans-serif; font-size:24px; font-weight:bold; color:#18181B;">
            </td>
          </tr>

          <!-- card principal -->
          <tr>
            <td style="background-color:#FFFFFF; border:1px solid #E4E4E7; border-radius:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                <!-- filete do espectro do agora (termina frio) -->
                <tr>
                  <td style="border-radius:16px 16px 0 0; overflow:hidden;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td width="33%" height="3" bgcolor="#C026D3" style="height:3px; font-size:1px; line-height:1px; border-radius:16px 0 0 0;">&nbsp;</td>
                        <td width="34%" height="3" bgcolor="#7C3AED" style="height:3px; font-size:1px; line-height:1px;">&nbsp;</td>
                        <td width="33%" height="3" bgcolor="#2563EB" style="height:3px; font-size:1px; line-height:1px; border-radius:0 16px 0 0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:40px 48px 8px;">
                    <h1 style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:24px; font-weight:bold; color:#18181B; mso-line-height-rule:exactly; line-height:32px;">Vamos recuperar sua conta</h1>
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:12px 48px 0;">
                    <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:15px; color:#52525B; mso-line-height-rule:exactly; line-height:24px;">Oi, <strong style="color:#18181B;">${escapeHtml(name)}</strong> — recebemos um pedido para redefinir a senha da conta ligada a este e-mail. Use o código abaixo no app para criar uma senha nova.</p>
                  </td>
                </tr>

                <!-- código de verificação -->
                <tr>
                  <td class="px" align="center" style="padding:32px 48px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td align="center" bgcolor="#FAFAFA" style="border:1px solid #E4E4E7; border-radius:14px; padding:24px 16px 26px;">
                          <p style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif; font-size:11px; font-weight:bold; letter-spacing:1.6px; text-transform:uppercase; color:#71717A; mso-line-height-rule:exactly; line-height:16px;">Seu código</p>
                          <p style="margin:0; font-family:'Courier New', Courier, monospace; font-size:38px; font-weight:bold; letter-spacing:8px; color:#18181B; mso-line-height-rule:exactly; line-height:44px;">${code}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:20px 48px 0;">
                    <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:13px; color:#71717A; mso-line-height-rule:exactly; line-height:20px;">O código vale por <strong style="color:#52525B;">${expiresInMinutes} minutos</strong> e só pode ser usado uma vez. Digite-o na tela de recuperação do app — nunca compartilhe com ninguém.</p>
                  </td>
                </tr>

                <!-- divisor -->
                <tr>
                  <td class="px" style="padding:28px 48px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr><td height="1" bgcolor="#E4E4E7" style="height:1px; font-size:1px; line-height:1px;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:20px 48px 40px;">
                    <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:13px; color:#71717A; mso-line-height-rule:exactly; line-height:20px;">Não foi você? Pode ignorar este e-mail — o código expira sozinho e sua senha continua a mesma.</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- rodapé -->
          <tr>
            <td align="center" style="padding:28px 24px 0;">
              <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#71717A; mso-line-height-rule:exactly; line-height:18px;">Você recebeu este e-mail porque alguém pediu a recuperação desta conta no Clubber.</p>
              <p style="margin:8px 0 0; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#71717A; mso-line-height-rule:exactly; line-height:18px;">Clubber · Curitiba, PR, Brasil · <a href="https://clubber.social/ajuda" style="color:#52525B; text-decoration:underline;">Central de ajuda</a></p>
              <img src="${ASSETS_BASE_URL}sticker.png" width="36" height="36" alt="b" style="display:inline-block; width:36px; height:36px; border:0; margin-top:20px;">
              <p style="margin:10px 0 0; font-family:Arial, Helvetica, sans-serif; font-size:11px; color:#A1A1AA; mso-line-height-rule:exactly; line-height:16px;">clubber.social</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}
