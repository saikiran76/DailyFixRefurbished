import React, { useState } from 'react';
import { Settings, X, Bell, Shield, Cog, Palette } from 'lucide-react';
import { FaWhatsapp, FaTelegram } from 'react-icons/fa';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ThemeToggle from "@/components/ui/ThemeToggle";

interface PlatformSettingsProps {
  onClose: () => void;
}

const ChatBackgroundSettings = () => {
  const [background, setBackground] = useState('default');
  const [customImageUrl, setCustomImageUrl] = useState('');

  const handleBackgroundChange = (value: string) => {
    setBackground(value);
  };

  const handleCustomImageUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomImageUrl(e.target.value);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-card-foreground mb-3 block">Select Background</label>
        <Select onValueChange={handleBackgroundChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="image">Custom Image URL</SelectItem>
            <SelectItem value="color">Solid Color</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {background === 'image' && (
        <div>
          <label className="text-sm font-medium text-card-foreground mb-3 block">Custom Image URL</label>
          <Input
            type="url"
            placeholder="Enter image URL"
            value={customImageUrl}
            onChange={handleCustomImageUrlChange}
          />
        </div>
      )}

      {background === 'color' && (
        <div>
          <label className="text-sm font-medium text-card-foreground mb-3 block">Select Color</label>
          {/* Add color picker component here */}
          <Input type="color" />
        </div>
      )}
    </div>
  );
};

export default function PlatformSettings({ onClose }: PlatformSettingsProps) {
  const [activeSection, setActiveSection] = useState('whatsapp');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-card-foreground">Platform Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex h-[calc(90vh-5rem)]">
          {/* Sidebar */}
          <div className="w-64 bg-muted/30 border-r border-border p-4 overflow-y-auto">
            <nav className="space-y-2">
              {[
                { id: 'whatsapp', label: 'WhatsApp', icon: FaWhatsapp, color: 'text-green-600' },
                { id: 'telegram', label: 'Telegram', icon: FaTelegram, color: 'text-blue-600' },
                { id: 'general', label: 'General', icon: Settings, color: 'text-muted-foreground' },
                { id: 'appearance', label: 'Appearance', icon: Palette, color: 'text-purple-600' },
                { id: 'notifications', label: 'Notifications', icon: Bell, color: 'text-yellow-600' },
                { id: 'privacy', label: 'Privacy & Security', icon: Shield, color: 'text-red-600' },
                { id: 'advanced', label: 'Advanced', icon: Cog, color: 'text-gray-600' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      activeSection === item.id
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'hover:bg-muted text-muted-foreground hover:text-card-foreground'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${activeSection === item.id ? 'text-primary' : item.color}`} />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {activeSection === 'whatsapp' && (
                <div className="space-y-6">
                  {/* WhatsApp Connection Status */}
                  <Card className="border-border">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                          <FaWhatsapp className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg text-card-foreground">WhatsApp Connection</CardTitle>
                          <CardDescription>Manage your WhatsApp integration</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* WhatsApp Connection Status */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-card-foreground">Status: <span className="font-medium text-green-500">Connected</span></p>
                          <Button variant="outline">Disconnect</Button>
                        </div>

                        {/* Phone Number Setting */}
                        <div>
                          <Label htmlFor="whatsapp-number">Phone Number</Label>
                          <Input type="tel" id="whatsapp-number" placeholder="+1 (555) 123-4567" />
                        </div>

                        {/* Auto-Reply Settings */}
                        <div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="auto-reply">Auto-Reply</Label>
                            <Switch id="auto-reply" />
                          </div>
                          <Textarea placeholder="Enter your auto-reply message here..." />
                        </div>

                        {/* Media Handling */}
                        <div>
                          <Label>Media Handling</Label>
                          <div className="flex items-center space-x-4">
                            <Button variant="outline">Download Media</Button>
                            <Button variant="secondary">Clear Media</Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'telegram' && (
                <div className="space-y-6">
                  {/* Telegram Connection Status */}
                  <Card className="border-border">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                          <FaTelegram className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg text-card-foreground">Telegram Connection</CardTitle>
                          <CardDescription>Manage your Telegram integration</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* Telegram Connection Status */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-card-foreground">Status: <span className="font-medium text-green-500">Connected</span></p>
                          <Button variant="outline">Disconnect</Button>
                        </div>

                        {/* Bot Token Setting */}
                        <div>
                          <Label htmlFor="telegram-token">Bot Token</Label>
                          <Input type="text" id="telegram-token" placeholder="Enter your bot token" />
                        </div>

                        {/* Channel ID Setting */}
                        <div>
                          <Label htmlFor="telegram-channel">Channel ID</Label>
                          <Input type="text" id="telegram-channel" placeholder="Enter your channel ID" />
                        </div>

                        {/* Auto-Reply Settings */}
                        <div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="telegram-auto-reply">Auto-Reply</Label>
                            <Switch id="telegram-auto-reply" />
                          </div>
                          <Textarea placeholder="Enter your auto-reply message here..." />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'appearance' && (
                <div className="space-y-6">
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-card-foreground">
                        <Palette className="w-5 h-5" />
                        Theme Settings
                      </CardTitle>
                      <CardDescription>Customize the appearance of your dashboard</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <label className="text-sm font-medium text-card-foreground mb-3 block">Theme Mode</label>
                        <div className="flex items-center justify-center">
                          <ThemeToggle showTooltip={false} />
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium text-card-foreground mb-3 block">Chat Background</label>
                        <ChatBackgroundSettings />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'general' && (
                <div className="space-y-6">
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-lg text-card-foreground">General Settings</CardTitle>
                      <CardDescription>Manage your general preferences</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="language">Language</Label>
                        <Select>
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="English" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">English</SelectItem>
                            <SelectItem value="es">Spanish</SelectItem>
                            <SelectItem value="fr">French</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="timezone">Timezone</Label>
                        <Input type="text" id="timezone" placeholder="Select timezone" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'notifications' && (
                <div className="space-y-6">
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-lg text-card-foreground">Notification Settings</CardTitle>
                      <CardDescription>Configure your notification preferences</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="email-notifications">Email Notifications</Label>
                        <Switch id="email-notifications" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="push-notifications">Push Notifications</Label>
                        <Switch id="push-notifications" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'privacy' && (
                <div className="space-y-6">
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-lg text-card-foreground">Privacy & Security</CardTitle>
                      <CardDescription>Manage your privacy and security settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="two-factor">Two-Factor Authentication</Label>
                        <Switch id="two-factor" />
                      </div>
                      <div>
                        <Label htmlFor="data-retention">Data Retention Period</Label>
                        <Select>
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="30 days" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7">7 days</SelectItem>
                            <SelectItem value="30">30 days</SelectItem>
                            <SelectItem value="90">90 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === 'advanced' && (
                <div className="space-y-6">
                  <Card className="border-border">
                    <CardHeader>
                      <CardTitle className="text-lg text-card-foreground">Advanced Settings</CardTitle>
                      <CardDescription>Configure advanced settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="api-key">API Key</Label>
                        <Input type="text" id="api-key" placeholder="Generate API Key" />
                      </div>
                      <div>
                        <Label htmlFor="debug-mode">Debug Mode</Label>
                        <div className="flex items-center justify-between">
                          <Switch id="debug-mode" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
