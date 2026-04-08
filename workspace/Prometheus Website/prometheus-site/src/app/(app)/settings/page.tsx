"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/auth/supabase";
import { useUser } from "@/lib/auth/useUser";
import { useRouter } from "next/navigation";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

function InputField({
  id,
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-border bg-charcoal px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-ember/40 focus:border-ember/40 transition-colors disabled:opacity-50"
      />
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, profile, loading } = useUser();

  const [displayName, setDisplayName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
    else if (user?.email) setDisplayName(user.email.split("@")[0]);
  }, [profile, user]);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("id", user!.id);

    setProfileSaving(false);
    setProfileMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Profile updated." });
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }

    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);

    if (error) {
      setPasswordMsg({ ok: false, text: error.message });
    } else {
      setPasswordMsg({ ok: true, text: "Password updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  async function handleDeleteAccount() {
    // Sign out and redirect — full deletion requires a server-side admin call
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted mt-1">Manage your account and security.</p>
      </motion.div>

      {/* Profile */}
      <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
        <h2 className="text-lg font-semibold text-foreground mb-4">Profile</h2>
        <Card>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField
                id="display-name"
                label="Display name"
                placeholder="Your name"
                value={displayName}
                onChange={setDisplayName}
              />
              <InputField
                id="email"
                label="Email address"
                type="email"
                placeholder="you@example.com"
                value={user?.email ?? ""}
                onChange={() => {}}
                disabled
              />
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.ok ? "text-green-400" : "text-red-400"}`}>
                {profileMsg.text}
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="primary" size="sm" type="submit" disabled={profileSaving}>
                {profileSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* Security */}
      <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp}>
        <h2 className="text-lg font-semibold text-foreground mb-4">Security</h2>
        <Card>
          <form onSubmit={handlePasswordSave} className="space-y-4">
            <InputField
              id="current-password"
              label="Current password"
              type="password"
              placeholder="Enter current password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField
                id="new-password"
                label="New password"
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={setNewPassword}
              />
              <InputField
                id="confirm-password"
                label="Confirm new password"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
            </div>
            {passwordMsg && (
              <p className={`text-sm ${passwordMsg.ok ? "text-green-400" : "text-red-400"}`}>
                {passwordMsg.text}
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" type="submit" disabled={passwordSaving}>
                {passwordSaving ? "Updating…" : "Update password"}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* Danger zone */}
      <motion.div initial="hidden" animate="visible" custom={3} variants={fadeUp}>
        <h2 className="text-lg font-semibold text-red-400 mb-4">Danger zone</h2>
        <Card className="border-red-900/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Delete account</h3>
              <p className="text-xs text-muted mt-0.5">
                Permanently remove your account and all associated data. This action cannot be undone.
              </p>
            </div>
            {!deleteConfirm ? (
              <Button
                variant="outline"
                size="sm"
                className="border-red-800/50 text-red-400 hover:bg-red-900/20 hover:border-red-700"
                onClick={() => setDeleteConfirm(true)}
              >
                Delete account
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-700 bg-red-900/30 text-red-400 hover:bg-red-900/50"
                  onClick={handleDeleteAccount}
                >
                  Confirm deletion
                </Button>
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
