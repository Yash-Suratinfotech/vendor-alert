// web/frontend/pages/settings.jsx
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Spinner,
  BlockStack,
  Form,
  Toast,
  Frame,
  Text,
} from "@shopify/polaris";
import React, { useState, useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

function SettingsPage() {
  const app = useAppBridge();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState(null);

  const toggleToastActive = useCallback(
    () => setToastActive((active) => !active),
    []
  );

  const showToast = useCallback((message, error = false) => {
    setToastMessage(message);
    setToastError(error);
    setToastActive(true);
  }, []);

  const getUserProfile = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/settings/profile");
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setUsername(data.user.username || "");
        setPhone(data.user.phone || "");
        setAvatarUrl(data.user.avatar_url || "");
      } else {
        const errorData = await response.json();
        showToast(
          `Error: ${errorData.error || "Failed to fetch profile"}`,
          true
        );
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
      showToast("Failed to fetch profile data.", true);
    } finally {
      setLoading(false);
    }
  }, [fetch, showToast]);

  useEffect(() => {
    getUserProfile();
  }, [getUserProfile]);

  const handleSave = useCallback(async () => {
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordError(null);

    setSubmitting(true);
    try {
      const response = await fetch("/api/settings/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          phone,
          avatar_url: avatarUrl,
          ...(password && { password }), // Only send password if it's not empty
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        showToast("Profile updated successfully!");
        setPassword(""); // Clear password fields after successful update
        setConfirmPassword("");
      } else {
        const errorData = await response.json();
        showToast(
          `Error: ${errorData.error || "Failed to update profile"}`,
          true
        );
      }
    } catch (error) {
      console.error("Failed to update profile:", error);
      showToast("Failed to update profile data.", true);
    } finally {
      setSubmitting(false);
    }
  }, [fetch, username, phone, avatarUrl, password, confirmPassword, showToast]);

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      error={toastError}
      onDismiss={toggleToastActive}
    />
  ) : null;

  if (loading) {
    return (
      <Frame>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100vh",
          }}
        >
          <Spinner accessibilityLabel="Loading profile" size="large" />
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page title="Settings">
        <Layout>
          <Layout.AnnotatedSection
            title="Profile Information"
            description="Manage your basic profile details."
          >
            <Card sectioned>
              <Form onSubmit={handleSave}>
                <FormLayout>
                  <TextField
                    label="Username"
                    value={username}
                    onChange={setUsername}
                    autoComplete="off"
                    disabled={submitting}
                  />
                  <TextField
                    label="Email (read-only)"
                    value={user?.email || ""}
                    autoComplete="email"
                    disabled
                  />
                  <TextField
                    label="Phone"
                    value={phone}
                    onChange={setPhone}
                    autoComplete="tel"
                    disabled={submitting}
                  />
                  <TextField
                    label="Avatar URL"
                    value={avatarUrl}
                    onChange={setAvatarUrl}
                    autoComplete="off"
                    disabled={submitting}
                  />
                  <BlockStack distribution="trailing">
                    <Button submit primary loading={submitting}>
                      Save
                    </Button>
                  </BlockStack>
                </FormLayout>
              </Form>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Security"
            description="Set or update your account password."
          >
            <Card sectioned>
              <Form onSubmit={handleSave}>
                <FormLayout>
                  {user?.has_password ? (
                    <Text as="p" color="subdued">
                      You can update your password below.
                    </Text>
                  ) : (
                    <Text as="p" color="warning">
                      You currently do not have a password set. Please set one
                      below.
                    </Text>
                  )}
                  <TextField
                    label="New Password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    error={passwordError}
                    disabled={submitting}
                  />
                  <TextField
                    label="Confirm New Password"
                    type="password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    error={passwordError}
                    disabled={submitting}
                  />
                  <BlockStack distribution="trailing">
                    <Button submit primary loading={submitting}>
                      Set Password
                    </Button>
                  </BlockStack>
                </FormLayout>
              </Form>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}

export default SettingsPage;
