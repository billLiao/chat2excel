import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { useTheme } from '@/components/theme-provider';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/agent/core';

interface ModelConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
}

export function SettingsPage() {
    const { t } = useTranslation();
    const { setTheme } = useTheme();
    const [loading, setLoading] = useState(false);
    const [models, setModels] = useState<ModelConfig[]>([]);
    const [activeModelId, setActiveModelId] = useState<string>('');
    const [settings, setSettings] = useState({
        theme: 'system',
        language: 'en',
        systemPrompt: ''
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const storedModels = await window.api.settings.get('models') || [];
            const storedActiveId = await window.api.settings.get('activeModelId') || '';
            const storedTheme = await window.api.settings.get('theme') || 'system';
            const storedLang = await window.api.settings.get('language') || 'en';
            const storedSystemPrompt = await window.api.settings.get('systemPrompt') || DEFAULT_SYSTEM_PROMPT;

            setModels(storedModels);
            setActiveModelId(storedActiveId);
            setSettings({
                theme: storedTheme as any,
                language: storedLang,
                systemPrompt: storedSystemPrompt
            });
        } catch (error) {
            console.error('Failed to load settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            await window.api.settings.set('models', models);
            await window.api.settings.set('activeModelId', activeModelId);
            await window.api.settings.set('theme', settings.theme);
            await window.api.settings.set('language', settings.language);
            await window.api.settings.set('systemPrompt', settings.systemPrompt);

            // Apply theme changes immediately in the UI
            setTheme(settings.theme as any);

            // Trigger i18n language change immediately
            await i18n.changeLanguage(settings.language);
            // Optionally show toast success
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const addModel = () => {
        const newModel = { name: t('settings.new_model'), baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-3.5-turbo' };
        setModels([...models, newModel]);
    };

    const removeModel = (index: number) => {
        const newModels = [...models];
        newModels.splice(index, 1);
        setModels(newModels);
    };

    const updateModel = (index: number, field: keyof ModelConfig, value: string) => {
        const newModels = [...models];
        newModels[index] = { ...newModels[index], [field]: value };
        setModels(newModels);
    };

    return (
        <div className="flex flex-col h-full bg-background p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto w-full space-y-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h2>
                    <p className="text-muted-foreground">{t('settings.description')}</p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('settings.model_config')}</CardTitle>
                        <CardDescription>{t('settings.model_desc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {models.map((model, idx) => (
                            <div key={idx} className="p-4 border rounded-lg space-y-3 bg-muted/20">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-sm">{t('settings.model_node', { index: idx + 1 })}</h4>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeModel(idx)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">{t('settings.display_name')}</label>
                                        <input
                                            className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={model.name}
                                            onChange={(e) => updateModel(idx, 'name', e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">{t('settings.base_url')}</label>
                                        <input
                                            className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={model.baseUrl}
                                            onChange={(e) => updateModel(idx, 'baseUrl', e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">{t('settings.api_key')}</label>
                                        <input
                                            type="password"
                                            className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={model.apiKey}
                                            onChange={(e) => updateModel(idx, 'apiKey', e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">{t('settings.model_id')}</label>
                                        <input
                                            className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={model.modelId}
                                            onChange={(e) => updateModel(idx, 'modelId', e.target.value)}
                                            placeholder="e.g. gpt-4, deepseek-chat"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="activeModel"
                                        id={`active-${idx}`}
                                        checked={activeModelId === model.name}
                                        onChange={() => setActiveModelId(model.name)}
                                        className="h-4 w-4"
                                    />
                                    <label htmlFor={`active-${idx}`} className="text-sm cursor-pointer select-none">{t('settings.set_active')}</label>
                                </div>
                            </div>
                        ))}

                        <Button variant="outline" size="sm" onClick={addModel} className="gap-2">
                            <Plus className="w-4 h-4" /> {t('settings.add_model')}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('settings.preferences')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('settings.system_prompt')}</label>
                            <textarea
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="You are a helpful data analyst..."
                                value={settings.systemPrompt}
                                onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">{t('settings.system_prompt_desc')}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('settings.theme')}</label>
                                <Select
                                    value={settings.theme}
                                    onValueChange={(value) => setSettings({ ...settings, theme: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('settings.theme')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">{t('settings.theme_light')}</SelectItem>
                                        <SelectItem value="dark">{t('settings.theme_dark')}</SelectItem>
                                        <SelectItem value="system">{t('settings.theme_system')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('settings.language')}</label>
                                <Select
                                    value={settings.language}
                                    onValueChange={(value) => setSettings({ ...settings, language: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('settings.language')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="en">English</SelectItem>
                                        <SelectItem value="zh">简体中文</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleSave} disabled={loading} className="gap-2 ml-auto">
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            <Save className="w-4 h-4" />
                            {t('settings.save')}
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
