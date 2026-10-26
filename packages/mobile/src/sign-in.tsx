import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Language, OtpChannel } from '@repo/contracts';
import { Button, Choice, Screen, Text, TextField, useTheme } from '@repo/ui-native';
import { useSession } from './session';

/**
 * Version of the WhatsApp notice (i18n key auth.whatsappNotice). Bump it
 * whenever that text changes so recorded consents point at what was shown.
 */
export const WHATSAPP_CONSENT_VERSION = 'wa-2026-10';

/** Seconds before "resend" and "get code by SMS instead" appear. */
export const RESEND_AFTER_SECONDS = 30;

type ErrorKey = 'auth.invalidPhone' | 'auth.wrongCode' | 'auth.tooMany' | 'auth.genericError';

function toE164(tenDigits: string) {
  return `+91${tenDigits}`;
}

/** Tells the API which channel to use, then asks Supabase to send the code. */
async function requestCode(session: ReturnType<typeof useSession>, phone: string, channel: OtpChannel, language: Language): Promise<ErrorKey | null> {
  const intent = await session.api.POST('/v1/auth/otp-intent', { body: { phone, channel, language } });
  if (intent.response.status === 429) return 'auth.tooMany';
  if (!intent.response.ok) return 'auth.genericError';
  const { error } = await session.supabase.auth.signInWithOtp({ phone });
  if (error) return error.status === 429 ? 'auth.tooMany' : 'auth.genericError';
  return null;
}

function Layout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space[5], paddingTop: space[16], gap: space[5] }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space[2] }} accessibilityRole="header">
            <Text variant="h2">{title}</Text>
            {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function PhoneSignInScreen({ onCodeSent }: { onCodeSent: (phone: string, channel: OtpChannel) => void }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const { space } = useTheme();
  const [digits, setDigits] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('whatsapp');
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[6-9]\d{9}$/.test(digits);

  async function submit() {
    if (!valid) return setError('auth.invalidPhone');
    setBusy(true);
    setError(null);
    try {
      const err = await requestCode(session, toE164(digits), channel, i18n.language as Language);
      if (err) setError(err);
      else onCodeSent(toE164(digits), channel);
    } catch {
      setError('auth.genericError');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title={t('auth.phoneTitle')} subtitle={t('auth.phoneSubtitle')}>
      <TextField
        label={t('auth.phoneLabel')}
        prefix="+91"
        value={digits}
        onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 10))}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={10}
        error={error ? t(error) : null}
        testID="phone-input"
      />
      <View style={{ gap: space[3] }} accessibilityRole="radiogroup" accessibilityLabel={t('auth.sendOn')}>
        <Text variant="small" weight="semibold" tone="muted">
          {t('auth.sendOn')}
        </Text>
        <Choice label={t('auth.whatsapp')} description={t('auth.whatsappNotice')} selected={channel === 'whatsapp'} onPress={() => setChannel('whatsapp')} testID="channel-whatsapp" />
        <Choice label={t('auth.sms')} selected={channel === 'sms'} onPress={() => setChannel('sms')} testID="channel-sms" />
      </View>
      <Button label={t('auth.sendCode')} onPress={submit} disabled={busy || !valid} testID="send-code" />
    </Layout>
  );
}

export function VerifyCodeScreen({ phone, channel: initialChannel, onChangeNumber }: { phone: string; channel: OtpChannel; onChangeNumber: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const { space } = useTheme();
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState(initialChannel);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => w - 1), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await session.supabase.auth.verifyOtp({ phone, token: value, type: 'sms' });
      if (err) {
        setError(err.status === 429 ? 'auth.tooMany' : 'auth.wrongCode');
        return;
      }
      if (channel === 'whatsapp') {
        // Consent is recorded only now that the phone is verified. A failure
        // here must not block sign-in; the profile screen can record it later.
        await session.api.POST('/v1/auth/whatsapp-optin', { body: { consentVersion: WHATSAPP_CONSENT_VERSION } }).catch(() => undefined);
      }
    } catch {
      setError('auth.genericError');
    } finally {
      setBusy(false);
    }
  }

  async function resend(next: OtpChannel) {
    setBusy(true);
    setError(null);
    try {
      const err = await requestCode(session, phone, next, i18n.language as Language);
      if (err) setError(err);
      else {
        setChannel(next);
        setWait(RESEND_AFTER_SECONDS);
      }
    } finally {
      setBusy(false);
    }
  }

  const masked = `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}`;

  return (
    <Layout title={t('auth.codeTitle')} subtitle={t('auth.codeSentTo', { phone: masked, channel: t(channel === 'whatsapp' ? 'auth.whatsapp' : 'auth.sms') })}>
      <TextField
        label={t('auth.codeLabel')}
        value={code}
        onChangeText={(v) => {
          const next = v.replace(/\D/g, '').slice(0, 6);
          setCode(next);
          if (next.length === 6) void verify(next);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        error={error ? t(error) : null}
        testID="code-input"
      />
      <Button label={t('auth.verify')} onPress={() => verify()} disabled={busy || code.length !== 6} testID="verify-code" />

      <View style={{ gap: space[3], alignItems: 'flex-start' }}>
        {wait > 0 ? (
          <Text tone="muted" accessibilityLiveRegion="polite">
            {t('auth.resendIn', { seconds: wait })}
          </Text>
        ) : (
          <>
            <LinkButton label={t('auth.resend')} onPress={() => resend(channel)} disabled={busy} />
            {channel === 'whatsapp' ? <LinkButton label={t('auth.useSms')} onPress={() => resend('sms')} disabled={busy} testID="use-sms" /> : null}
          </>
        )}
        <LinkButton label={t('auth.changeNumber')} onPress={onChangeNumber} />
      </View>
    </Layout>
  );
}

function LinkButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const { tapTarget } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} testID={testID} style={{ minHeight: tapTarget, justifyContent: 'center' }}>
      <Text weight="bold" tone="accent">
        {label}
      </Text>
    </Pressable>
  );
}
