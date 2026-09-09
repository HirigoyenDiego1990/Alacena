const crypto = require('node:crypto');

function getPremiumNotificationConfig(env = process.env) {
    const resendApiKey = String(env.RESEND_API_KEY || '').trim();
    const adminEmail = String(env.PREMIUM_ADMIN_EMAIL || '').trim().toLowerCase();

    return {
        configured: resendApiKey.startsWith('re_') && adminEmail.includes('@'),
        resendApiKey,
        adminEmail,
        from: String(env.PREMIUM_NOTIFICATION_FROM || 'Alacena <onboarding@resend.dev>').trim(),
        supabaseUrl: String(env.SUPABASE_URL || '').trim().replace(/\/$/, ''),
        supabaseAnonKey: String(env.SUPABASE_ANON_KEY || '').trim()
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function buildPremiumRequestEmail(requestData) {
    const isRenewal = requestData.request_type === 'renewal';
    const action = isRenewal ? 'renovación' : 'activación';
    const reference = requestData.payment_reference || 'No informada';
    const reportedAt = requestData.payment_reported_at
        ? new Intl.DateTimeFormat('es-AR', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'America/Argentina/Buenos_Aires'
        }).format(new Date(requestData.payment_reported_at))
        : 'Sin informar';

    return {
        subject: `Nuevo pago para ${action} Premium`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2a22">
                <h2 style="color:#c77716">Alacena Premium</h2>
                <p>Recibiste un nuevo aviso de pago para <strong>${action}</strong>.</p>
                <table style="width:100%;border-collapse:collapse">
                    <tr><td style="padding:8px;border-bottom:1px solid #eee">Nombre</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${escapeHtml(requestData.payer_name || 'Sin informar')}</strong></td></tr>
                    <tr><td style="padding:8px;border-bottom:1px solid #eee">Cuenta</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${escapeHtml(requestData.contact_email || 'Sin informar')}</strong></td></tr>
                    <tr><td style="padding:8px;border-bottom:1px solid #eee">Referencia</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${escapeHtml(reference)}</strong></td></tr>
                    <tr><td style="padding:8px;border-bottom:1px solid #eee">Aviso recibido</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${escapeHtml(reportedAt)}</strong></td></tr>
                </table>
                <p style="margin-top:20px">Verificá la transferencia en Prex y después aprobala desde el panel del escudo en Alacena.</p>
                <p style="font-size:12px;color:#657068">Este mensaje no confirma el pago ni activa Premium automáticamente.</p>
            </div>
        `
    };
}

async function handlePremiumRequestNotification(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const config = getPremiumNotificationConfig();
    if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
        return response.status(503).json({ error: 'NOTIFICATION_NOT_CONFIGURED' });
    }

    const authorization = String(request.headers?.authorization || '');
    if (!authorization.startsWith('Bearer ')) {
        return response.status(401).json({ error: 'AUTH_REQUIRED' });
    }

    try {
        const claimResponse = await fetch(`${config.supabaseUrl}/rest/v1/rpc/claim_premium_payment_notification`, {
            method: 'POST',
            headers: {
                apikey: config.supabaseAnonKey,
                Authorization: authorization,
                'Content-Type': 'application/json'
            },
            body: '{}'
        });

        if (!claimResponse.ok) {
            return response.status(claimResponse.status === 401 ? 401 : 502).json({ error: 'NOTIFICATION_CLAIM_FAILED' });
        }

        const requestData = await claimResponse.json();
        if (!requestData || requestData.status !== 'claimed') {
            return response.status(202).json({ status: 'already_notified' });
        }

        const email = buildPremiumRequestEmail(requestData);
        const idempotencyKey = crypto
            .createHash('sha256')
            .update(`${requestData.user_id}:${requestData.payment_reported_at}`)
            .digest('hex');
        const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.resendApiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `premium-${idempotencyKey}`
            },
            body: JSON.stringify({
                from: config.from,
                to: [config.adminEmail],
                subject: email.subject,
                html: email.html
            })
        });

        if (!emailResponse.ok) {
            return response.status(502).json({ error: 'EMAIL_SEND_FAILED' });
        }

        return response.status(200).json({ status: 'sent' });
    } catch (_error) {
        return response.status(502).json({ error: 'NOTIFICATION_FAILED' });
    }
}

module.exports = {
    buildPremiumRequestEmail,
    escapeHtml,
    getPremiumNotificationConfig,
    handlePremiumRequestNotification
};
