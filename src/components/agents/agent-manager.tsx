import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Check,
    FileText,
    FolderOpen,
    FolderSearch,
    Loader2,
    Plug,
    Puzzle,
    RefreshCw,
    Search,
    Trash2,
    Upload,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
    AgentInstruction,
    AgentInstructionDetail,
    AgentOverview,
    AgentSkill,
    AgentSkillDetail,
    AgentSourceInfo,
    McpServerInfo,
} from '@/lib/agents/types';
import { useTranslation } from 'react-i18next';

type TabKey = 'skills' | 'mcp' | 'instructions';

function endpointOf(server: McpServerInfo): string {
    if (server.transport === 'stdio') {
        return [server.command, ...(server.args || [])].filter(Boolean).join(' ');
    }
    return server.url || '';
}

function statusVariant(server: McpServerInfo): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (server.status === 'connected') return 'default';
    if (server.status === 'error') return 'destructive';
    if (server.status === 'connecting') return 'outline';
    return 'secondary';
}

export function AgentManager() {
    const { t } = useTranslation();
    const [overview, setOverview] = useState<AgentOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [tab, setTab] = useState<TabKey>('skills');
    const [search, setSearch] = useState('');
    const [skillDetail, setSkillDetail] = useState<AgentSkillDetail | null>(null);
    const [instructionDetail, setInstructionDetail] =
        useState<AgentInstructionDetail | null>(null);
    const [instructionDraft, setInstructionDraft] = useState('');
    const [showSources, setShowSources] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await window.api.agents.overview();
            if (!response.success || !response.data) {
                throw new Error(response.error || t('agents.operation_failed'));
            }
            setOverview(response.data);
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    const run = async (key: string, action: () => Promise<any>, success?: string) => {
        setBusy(key);
        setError(null);
        setMessage(null);
        try {
            const response = await action();
            if (response?.canceled) return response;
            if (response && response.success === false) {
                throw new Error(response.error || t('agents.operation_failed'));
            }
            if (success) setMessage(success);
            return response;
        } catch (err: any) {
            setError(err?.message || String(err));
            return null;
        } finally {
            setBusy(null);
        }
    };

    const importSkill = (kind: 'folder' | 'file') =>
        run(`import-skill-${kind}`, () => window.api.agents.importSkill(kind)).then(
            (response) => {
                if (response?.success) {
                    if (response.data) setOverview(response.data);
                    setMessage(t('agents.imported', { count: response.imported || 1 }));
                }
            }
        );

    const toggleSkill = (skill: AgentSkill, enabled: boolean) =>
        run(`skill-${skill.id}`, async () => {
            const response = await window.api.agents.setSkillEnabled(skill.id, enabled);
            if (response.success) {
                setOverview((prev) =>
                    prev
                        ? {
                              ...prev,
                              skills: prev.skills.map((item) =>
                                  item.id === skill.id ? { ...item, enabled } : item
                              ),
                              stats: {
                                  ...prev.stats,
                                  skillsEnabled: prev.skills.filter((item) =>
                                      item.id === skill.id ? enabled : item.enabled
                                  ).length,
                              },
                          }
                        : prev
                );
            }
            return response;
        });

    const openSkill = (skill: AgentSkill) =>
        run(`detail-${skill.id}`, async () => {
            const response = await window.api.agents.skillContent(skill.id);
            if (response.success && response.data) setSkillDetail(response.data);
            return response;
        });

    const deleteSkill = async (skill: AgentSkill) => {
        if (!window.confirm(t('agents.confirm_delete_skill'))) return;
        await run(`delete-${skill.id}`, () => window.api.agents.deleteSkill(skill.id));
        await load();
    };

    const toggleInstruction = (instruction: AgentInstruction, enabled: boolean) =>
        run(`instruction-${instruction.id}`, async () => {
            const response = await window.api.agents.setInstructionEnabled(
                instruction.id,
                enabled
            );
            if (response.success) {
                setOverview((prev) =>
                    prev
                        ? {
                              ...prev,
                              instructions: prev.instructions.map((item) =>
                                  item.id === instruction.id ? { ...item, enabled } : item
                              ),
                              stats: {
                                  ...prev.stats,
                                  instructionsEnabled: prev.instructions.filter((item) =>
                                      item.id === instruction.id ? enabled : item.enabled
                                  ).length,
                              },
                          }
                        : prev
                );
            }
            return response;
        });

    const openInstruction = (instruction: AgentInstruction) =>
        run(`instruction-detail-${instruction.id}`, async () => {
            const response = await window.api.agents.instructionContent(instruction.id);
            if (response.success && response.data) {
                setInstructionDetail(response.data);
                setInstructionDraft(response.data.content);
            }
            return response;
        });

    const saveInstruction = () => {
        if (!instructionDetail) return;
        void run(
            'save-instruction',
            () =>
                window.api.agents.saveInstruction(
                    instructionDetail.id,
                    instructionDraft
                ),
            t('agents.saved')
        ).then((response) => {
            if (response?.success) {
                setInstructionDetail({ ...instructionDetail, content: instructionDraft });
                void load();
            }
        });
    };

    const deleteInstruction = async (instruction: AgentInstruction) => {
        if (!window.confirm(t('agents.confirm_delete_instruction'))) return;
        await run(`instruction-delete-${instruction.id}`, () =>
            window.api.agents.deleteInstruction(instruction.id)
        );
        await load();
    };

    const toggleMcp = (server: McpServerInfo, enabled: boolean) =>
        run(`mcp-${server.id}`, () =>
            window.api.agents.setMcpEnabled(server.id, enabled)
        ).then((response) => {
            if (response?.success && response.data) setOverview(response.data);
        });

    const testMcp = (server: McpServerInfo) =>
        run(`mcp-test-${server.id}`, async () => {
            const response = await window.api.agents.testMcp(server.id);
            if (response.success && response.server) {
                setOverview((prev) =>
                    prev
                        ? {
                              ...prev,
                              mcpServers: prev.mcpServers.map((item) =>
                                  item.id === response.server!.id ? response.server! : item
                              ),
                          }
                        : prev
                );
                setMessage(
                    t('agents.test_ok', { count: response.server.tools.length })
                );
            }
            return response;
        });

    const removeMcp = async (server: McpServerInfo) => {
        if (!window.confirm(t('agents.confirm_remove_mcp'))) return;
        await run(`mcp-remove-${server.id}`, () =>
            window.api.agents.removeMcp(server.id)
        );
        await load();
    };

    const setWorkspace = () =>
        run('workspace', () => window.api.agents.setWorkspace()).then((response) => {
            if (response?.success && response.data) setOverview(response.data);
        });

    const clearWorkspace = () =>
        run('workspace-clear', () => window.api.agents.clearWorkspace()).then((response) => {
            if (response?.success && response.data) setOverview(response.data);
        });

    const filteredSkills = useMemo(() => {
        const list = overview?.skills || [];
        const query = search.trim().toLowerCase();
        if (!query) return list;
        return list.filter(
            (skill) =>
                skill.name.toLowerCase().includes(query) ||
                skill.description.toLowerCase().includes(query) ||
                skill.sourceLabel.toLowerCase().includes(query)
        );
    }, [overview, search]);

    const sourcesForTab: AgentSourceInfo[] = overview
        ? tab === 'skills'
            ? overview.sources.skills
            : tab === 'mcp'
              ? overview.sources.mcp
              : overview.sources.instructions
        : [];

    if (loading && !overview) {
        return (
            <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('common.loading')}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            <div className="border-b px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">
                            {t('agents.title')}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('agents.description')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void load()}
                            disabled={loading}
                        >
                            <RefreshCw
                                className={cn('mr-1 h-4 w-4', loading && 'animate-spin')}
                            />
                            {t('agents.refresh')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void setWorkspace()}
                            disabled={busy === 'workspace'}
                        >
                            <FolderOpen className="mr-1 h-4 w-4" />
                            {t('agents.set_workspace')}
                        </Button>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{t('agents.workspace')}:</span>
                    {overview?.workspace ? (
                        <>
                            <Badge variant="outline" className="max-w-[420px] truncate font-mono">
                                {overview.workspace}
                            </Badge>
                            <button
                                className="underline underline-offset-2 hover:text-foreground"
                                onClick={() => void clearWorkspace()}
                            >
                                {t('agents.clear_workspace')}
                            </button>
                        </>
                    ) : (
                        <span>{t('agents.no_workspace')}</span>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    {message && (
                        <Alert>
                            <Check className="h-4 w-4" />
                            <AlertDescription>{message}</AlertDescription>
                        </Alert>
                    )}

                    {overview && (
                        <>
                            <div className="flex flex-wrap gap-2 text-xs">
                                <Badge variant="secondary">
                                    {t('agents.skills')}:{' '}
                                    {t('agents.enabled_count', {
                                        enabled: overview.stats.skillsEnabled,
                                        total: overview.stats.skills,
                                    })}
                                </Badge>
                                <Badge variant="secondary">
                                    MCP:{' '}
                                    {t('agents.enabled_count', {
                                        enabled: overview.stats.mcpEnabled,
                                        total: overview.stats.mcpServers,
                                    })}{' '}
                                    · {t('agents.mcp_tool_count', { count: overview.stats.mcpTools })}
                                </Badge>
                                <Badge variant="secondary">
                                    {t('agents.instructions')}:{' '}
                                    {t('agents.enabled_count', {
                                        enabled: overview.stats.instructionsEnabled,
                                        total: overview.stats.instructions,
                                    })}
                                </Badge>
                                <span className="self-center text-muted-foreground">
                                    {t('agents.agent_ready')}
                                </span>
                            </div>

                            <Tabs
                                value={tab}
                                onValueChange={(value) => setTab(value as TabKey)}
                            >
                                <TabsList>
                                    <TabsTrigger value="skills">
                                        <Puzzle className="mr-1 h-4 w-4" />
                                        {t('agents.skills')}
                                    </TabsTrigger>
                                    <TabsTrigger value="mcp">
                                        <Plug className="mr-1 h-4 w-4" />
                                        {t('agents.mcp')}
                                    </TabsTrigger>
                                    <TabsTrigger value="instructions">
                                        <FileText className="mr-1 h-4 w-4" />
                                        {t('agents.instructions')}
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="skills" className="mt-4 space-y-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="relative min-w-[220px] flex-1">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                className="pl-8"
                                                placeholder={t('agents.search')}
                                                value={search}
                                                onChange={(event) => setSearch(event.target.value)}
                                            />
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={() => void importSkill('folder')}
                                            disabled={busy === 'import-skill-folder'}
                                        >
                                            {busy === 'import-skill-folder' ? (
                                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Upload className="mr-1 h-4 w-4" />
                                            )}
                                            {t('agents.import_folder')}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void importSkill('file')}
                                            disabled={busy === 'import-skill-file'}
                                        >
                                            <FileText className="mr-1 h-4 w-4" />
                                            {t('agents.import_file')}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t('agents.skills_desc')}
                                    </p>

                                    {filteredSkills.length === 0 ? (
                                        <EmptyState
                                            icon={<FolderSearch className="h-8 w-8" />}
                                            text={t('agents.empty_skills')}
                                        />
                                    ) : (
                                        <div className="grid gap-3 md:grid-cols-2">
                                            {filteredSkills.map((skill) => (
                                                <SkillCard
                                                    key={skill.id}
                                                    skill={skill}
                                                    busy={busy === `skill-${skill.id}`}
                                                    onToggle={toggleSkill}
                                                    onView={openSkill}
                                                    onDelete={deleteSkill}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="mcp" className="mt-4 space-y-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void run(
                                                    'import-mcp',
                                                    () => window.api.agents.importMcp()
                                                ).then((response) => {
                                                    if (response?.success) {
                                                        if (response.data) {
                                                            setOverview(response.data);
                                                        }
                                                        setMessage(
                                                            t('agents.imported', {
                                                                count: response.imported || 1,
                                                            })
                                                        );
                                                    }
                                                })
                                            }
                                            disabled={busy === 'import-mcp'}
                                        >
                                            {busy === 'import-mcp' ? (
                                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Upload className="mr-1 h-4 w-4" />
                                            )}
                                            {t('agents.import_config')}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void run('mcp-refresh', () =>
                                                    window.api.agents.mcpRefresh()
                                                ).then((response) => {
                                                    if (response?.success && response.data) {
                                                        setOverview(response.data);
                                                    }
                                                })
                                            }
                                            disabled={busy === 'mcp-refresh'}
                                        >
                                            {busy === 'mcp-refresh' ? (
                                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="mr-1 h-4 w-4" />
                                            )}
                                            {t('agents.refresh')}
                                        </Button>
                                    </div>
                                    <Alert variant="warning">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>{t('agents.trust_warning')}</AlertDescription>
                                    </Alert>

                                    {(overview.mcpServers || []).length === 0 ? (
                                        <EmptyState
                                            icon={<Plug className="h-8 w-8" />}
                                            text={t('agents.empty_mcp')}
                                        />
                                    ) : (
                                        <div className="space-y-3">
                                            {overview.mcpServers.map((server) => (
                                                <McpCard
                                                    key={server.id}
                                                    server={server}
                                                    busy={busy === `mcp-${server.id}`}
                                                    testing={busy === `mcp-test-${server.id}`}
                                                    onToggle={toggleMcp}
                                                    onTest={testMcp}
                                                    onRemove={removeMcp}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="instructions" className="mt-4 space-y-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void run(
                                                    'import-instruction',
                                                    () => window.api.agents.importInstruction()
                                                ).then((response) => {
                                                    if (response?.success && response.data) {
                                                        setOverview(response.data);
                                                    }
                                                })
                                            }
                                            disabled={busy === 'import-instruction'}
                                        >
                                            {busy === 'import-instruction' ? (
                                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Upload className="mr-1 h-4 w-4" />
                                            )}
                                            {t('agents.import_instructions')}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {t('agents.instructions_desc')} {t('agents.instructions_limit')}
                                    </p>

                                    {(overview.instructions || []).length === 0 ? (
                                        <EmptyState
                                            icon={<FileText className="h-8 w-8" />}
                                            text={t('agents.empty_instructions')}
                                        />
                                    ) : (
                                        <div className="space-y-3">
                                            {overview.instructions.map((instruction) => (
                                                <InstructionCard
                                                    key={instruction.id}
                                                    instruction={instruction}
                                                    busy={busy === `instruction-${instruction.id}`}
                                                    onToggle={toggleInstruction}
                                                    onView={openInstruction}
                                                    onDelete={deleteInstruction}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>

                            <div className="rounded-lg border bg-muted/20">
                                <button
                                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
                                    onClick={() => setShowSources((value) => !value)}
                                >
                                    <span>{t('agents.scan_sources')}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {showSources ? '−' : '+'}
                                    </span>
                                </button>
                                {showSources && (
                                    <div className="space-y-1 border-t px-4 py-3">
                                        {sourcesForTab.map((source) => (
                                            <div
                                                key={source.id}
                                                className="flex flex-wrap items-center gap-2 text-xs"
                                            >
                                                <Badge
                                                    variant={source.exists ? 'outline' : 'secondary'}
                                                    className="shrink-0"
                                                >
                                                    {source.exists
                                                        ? t('agents.exists')
                                                        : t('agents.missing')}
                                                </Badge>
                                                <span className="font-medium">{source.label}</span>
                                                <span className="truncate font-mono text-muted-foreground">
                                                    {source.path}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <Dialog
                open={!!skillDetail}
                onOpenChange={(open) => {
                    if (!open) setSkillDetail(null);
                }}
            >
                <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {skillDetail?.name || t('agents.skill_detail')}
                        </DialogTitle>
                        <DialogDescription>
                            {skillDetail?.description}
                        </DialogDescription>
                    </DialogHeader>
                    {skillDetail && (
                        <div className="min-h-0 space-y-3 overflow-y-auto">
                            <div className="flex flex-wrap gap-1.5 text-xs">
                                <Badge variant="secondary">{skillDetail.sourceLabel}</Badge>
                                {skillDetail.builtin && (
                                    <Badge variant="outline">{t('agents.builtin')}</Badge>
                                )}
                                {skillDetail.version && (
                                    <Badge variant="outline">v{skillDetail.version}</Badge>
                                )}
                                {skillDetail.author && (
                                    <Badge variant="outline">{skillDetail.author}</Badge>
                                )}
                                <Badge variant="outline">{skillDetail.path}</Badge>
                            </div>
                            {skillDetail.warnings.length > 0 && (
                                <Alert variant="warning">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        {skillDetail.warnings.join(' ')}
                                    </AlertDescription>
                                </Alert>
                            )}
                            {skillDetail.files.length > 0 && (
                                <div>
                                    <h4 className="mb-1 text-xs font-semibold">
                                        {t('agents.files')}
                                    </h4>
                                    <div className="flex flex-wrap gap-1">
                                        {skillDetail.files.map((file) => (
                                            <Badge key={file} variant="outline" className="font-mono">
                                                {file}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div>
                                <h4 className="mb-1 text-xs font-semibold">
                                    {t('agents.content')}
                                </h4>
                                <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                                    {skillDetail.content}
                                </pre>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSkillDetail(null)}>
                            {t('agents.close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!instructionDetail}
                onOpenChange={(open) => {
                    if (!open) setInstructionDetail(null);
                }}
            >
                <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {instructionDetail?.name || t('agents.instruction_detail')}
                        </DialogTitle>
                        <DialogDescription className="font-mono text-xs">
                            {instructionDetail?.path}
                        </DialogDescription>
                    </DialogHeader>
                    {instructionDetail && (
                        <div className="min-h-0 space-y-2 overflow-y-auto">
                            <div className="flex flex-wrap gap-1.5 text-xs">
                                <Badge variant="secondary">
                                    {instructionDetail.sourceLabel}
                                </Badge>
                                <Badge variant="outline">
                                    {Math.round(instructionDetail.size / 1024)} KB
                                </Badge>
                            </div>
                            {instructionDetail.managed ? (
                                <textarea
                                    className="min-h-[38vh] w-full resize-y rounded-md border bg-background p-3 font-mono text-xs"
                                    value={instructionDraft}
                                    onChange={(event) => setInstructionDraft(event.target.value)}
                                />
                            ) : (
                                <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                                    {instructionDetail.content}
                                </pre>
                            )}
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setInstructionDetail(null)}>
                            {t('agents.close')}
                        </Button>
                        {instructionDetail?.managed && (
                            <Button
                                onClick={saveInstruction}
                                disabled={busy === 'save-instruction'}
                            >
                                {busy === 'save-instruction' && (
                                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                )}
                                {t('agents.save')}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            <div className="rounded-full bg-muted p-3">{icon}</div>
            <p>{text}</p>
        </div>
    );
}

function SkillCard({
    skill,
    busy,
    onToggle,
    onView,
    onDelete,
}: {
    skill: AgentSkill;
    busy: boolean;
    onToggle: (skill: AgentSkill, enabled: boolean) => void;
    onView: (skill: AgentSkill) => void;
    onDelete: (skill: AgentSkill) => void;
}) {
    const { t } = useTranslation();
    return (
        <Card className={cn('transition-colors', !skill.enabled && 'opacity-70')}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Puzzle className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate">{skill.name}</span>
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="secondary" className="text-[10px]">
                                {skill.sourceLabel}
                            </Badge>
                            {skill.builtin && (
                                <Badge variant="outline" className="text-[10px]">
                                    {t('agents.builtin')}
                                </Badge>
                            )}
                            {skill.managed && (
                                <Badge variant="outline" className="text-[10px]">
                                    {t('agents.managed')}
                                </Badge>
                            )}
                            {skill.version && (
                                <Badge variant="outline" className="text-[10px]">
                                    v{skill.version}
                                </Badge>
                            )}
                        </div>
                    </div>
                    <Switch
                        checked={skill.enabled}
                        disabled={busy || skill.builtin}
                        title={skill.builtin ? t('agents.builtin_locked') : undefined}
                        onCheckedChange={(checked) => onToggle(skill, checked)}
                    />
                </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                    {skill.description}
                </p>
                <p
                    className="truncate font-mono text-[11px] text-muted-foreground/70"
                    title={skill.path}
                >
                    {skill.path}
                </p>
                {skill.warnings.length > 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-yellow-600">
                        <AlertCircle className="h-3 w-3" />
                        {skill.warnings.join(' ')}
                    </p>
                )}
                <div className="flex gap-2 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => onView(skill)}
                    >
                        {t('agents.view')}
                    </Button>
                    {skill.managed && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => onDelete(skill)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function McpCard({
    server,
    busy,
    testing,
    onToggle,
    onTest,
    onRemove,
}: {
    server: McpServerInfo;
    busy: boolean;
    testing: boolean;
    onToggle: (server: McpServerInfo, enabled: boolean) => void;
    onTest: (server: McpServerInfo) => void;
    onRemove: (server: McpServerInfo) => void;
}) {
    const { t } = useTranslation();
    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Plug className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate">{server.name}</span>
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="secondary" className="text-[10px]">
                                {server.sourceLabel}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                                {server.transport}
                            </Badge>
                            {!server.managed && (
                                <Badge variant="outline" className="text-[10px]">
                                    {t('agents.scanned')}
                                </Badge>
                            )}
                            <Badge variant={statusVariant(server)} className="text-[10px]">
                                {server.status === 'connected'
                                    ? t('agents.connected')
                                    : server.status === 'connecting'
                                      ? t('agents.connecting')
                                      : server.status === 'error'
                                        ? t('agents.error')
                                        : server.enabled
                                          ? t('agents.disconnected')
                                          : server.managed
                                            ? t('agents.disabled')
                                            : t('agents.not_imported')}
                            </Badge>
                        </div>
                    </div>
                    <Switch
                        checked={server.enabled}
                        disabled={busy}
                        onCheckedChange={(checked) => onToggle(server, checked)}
                    />
                </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
                <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={endpointOf(server)}
                >
                    {endpointOf(server)}
                </p>
                {server.error && (
                    <p className="text-xs text-destructive">{server.error}</p>
                )}
                <div className="flex flex-wrap items-center gap-1">
                    {server.tools.length > 0 ? (
                        server.tools.slice(0, 12).map((tool) => (
                            <Badge
                                key={tool.name}
                                variant="outline"
                                className="font-mono text-[10px]"
                                title={tool.description}
                            >
                                {tool.name}
                            </Badge>
                        ))
                    ) : (
                        <span className="text-[11px] text-muted-foreground">
                            {t('agents.no_tools')}
                        </span>
                    )}
                    {server.tools.length > 12 && (
                        <Badge variant="secondary" className="text-[10px]">
                            +{server.tools.length - 12}
                        </Badge>
                    )}
                </div>
                <div className="flex gap-2 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onTest(server)}
                        disabled={testing}
                    >
                        {testing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        {testing ? t('agents.testing') : t('agents.test')}
                    </Button>
                    {server.managed && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => onRemove(server)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function InstructionCard({
    instruction,
    busy,
    onToggle,
    onView,
    onDelete,
}: {
    instruction: AgentInstruction;
    busy: boolean;
    onToggle: (instruction: AgentInstruction, enabled: boolean) => void;
    onView: (instruction: AgentInstruction) => void;
    onDelete: (instruction: AgentInstruction) => void;
}) {
    const { t } = useTranslation();
    return (
        <Card className={cn(!instruction.enabled && 'opacity-70')}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <FileText className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate">{instruction.name}</span>
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="secondary" className="text-[10px]">
                                {instruction.sourceLabel}
                            </Badge>
                            {instruction.managed && (
                                <Badge variant="outline" className="text-[10px]">
                                    {t('agents.managed')}
                                </Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">
                                {Math.round(instruction.size / 1024)} KB
                            </Badge>
                        </div>
                    </div>
                    <Switch
                        checked={instruction.enabled}
                        disabled={busy}
                        onCheckedChange={(checked) => onToggle(instruction, checked)}
                    />
                </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                    {instruction.preview || '—'}
                </p>
                <p
                    className="truncate font-mono text-[11px] text-muted-foreground/70"
                    title={instruction.path}
                >
                    {instruction.path}
                </p>
                <div className="flex gap-2 pt-1">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => onView(instruction)}
                    >
                        {t('agents.view')}
                    </Button>
                    {instruction.managed && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => onDelete(instruction)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
