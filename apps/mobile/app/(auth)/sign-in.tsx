import { useSignIn } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../../src/theme/theme";
import { Screen } from "../../src/ui";

function isClerkConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

/** Sign in with Apple + email code placeholders via @clerk/expo. */
export default function SignInScreen() {
  if (!isClerkConfigured()) {
    return <SignInPlaceholder />;
  }
  return <ClerkSignIn />;
}

function SignInPlaceholder() {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.centerPad}>
      <Text style={[styles.brand, { color: theme.colors.ink }]}>Yatma</Text>
      <Text style={{ color: theme.colors.muted, fontSize: theme.type.row, marginBottom: 24 }}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to enable Clerk sign-in.
      </Text>
      <Pressable
        onPress={() => router.replace("/(tabs)")}
        style={[styles.primary, { backgroundColor: theme.colors.pine }]}
      >
        <Text style={{ color: theme.colors.onPine, fontWeight: "600", textAlign: "center" }}>
          Continue offline
        </Text>
      </Pressable>
    </Screen>
  );
}

function ClerkSignIn() {
  const router = useRouter();
  const theme = useTheme();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);

  async function onApple() {
    try {
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace("/(tabs)");
      }
    } catch (error) {
      Alert.alert("Apple sign-in failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function onEmailStart() {
    if (!signIn) return;
    try {
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) {
        Alert.alert("Email sign-in failed", created.error.message);
        return;
      }
      const sent = await signIn.emailCode.sendCode();
      if (sent.error) {
        Alert.alert("Email sign-in failed", sent.error.message);
        return;
      }
      setPendingVerification(true);
    } catch (error) {
      Alert.alert("Email sign-in failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function onEmailVerify() {
    if (!signIn) return;
    try {
      const verified = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (verified.error) {
        Alert.alert("Verification failed", verified.error.message);
        return;
      }
      const finalized = await signIn.finalize();
      if (finalized.error) {
        Alert.alert("Verification failed", finalized.error.message);
        return;
      }
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert("Verification failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.centerPad}>
      <Text style={[styles.brand, { color: theme.colors.ink }]}>Yatma</Text>
      <Text style={{ color: theme.colors.muted, fontSize: theme.type.row, marginBottom: 28 }}>
        Sign in to sync across devices.
      </Text>

      <Pressable onPress={() => void onApple()} style={[styles.primary, { backgroundColor: "#000" }]}>
        <Text style={{ color: "#fff", fontWeight: "600", textAlign: "center" }}>
          Sign in with Apple
        </Text>
      </Pressable>

      <Text
        style={{
          color: theme.colors.muted,
          fontSize: theme.type.meta,
          fontWeight: "600",
          marginTop: 28,
          marginBottom: 8,
        }}
      >
        Email code
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={theme.colors.muted}
        style={[
          styles.input,
          {
            color: theme.colors.ink,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.surface,
          },
        ]}
      />
      {pendingVerification ? (
        <>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor={theme.colors.muted}
            style={[
              styles.input,
              {
                color: theme.colors.ink,
                borderColor: theme.colors.line,
                backgroundColor: theme.colors.surface,
              },
            ]}
          />
          <Pressable
            onPress={() => void onEmailVerify()}
            style={[styles.primary, { backgroundColor: theme.colors.pine }]}
          >
            <Text style={{ color: theme.colors.onPine, fontWeight: "600", textAlign: "center" }}>
              Verify code
            </Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => void onEmailStart()}
          style={[styles.primary, { backgroundColor: theme.colors.pine }]}
        >
          <Text style={{ color: theme.colors.onPine, fontWeight: "600", textAlign: "center" }}>
            Send code
          </Text>
        </Pressable>
      )}

      <Pressable onPress={() => router.replace("/(tabs)")} style={styles.offline}>
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.row, textAlign: "center" }}>
          Continue offline
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerPad: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  brand: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  primary: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: "center",
    marginBottom: 10,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
    minHeight: 48,
  },
  offline: {
    marginTop: 16,
    minHeight: 44,
    justifyContent: "center",
  },
});
