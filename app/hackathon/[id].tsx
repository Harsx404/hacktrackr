import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  Plus,
  ExternalLink,
  Flag,
  Trash2,
  ChevronRight,
  Edit2,
  X,
  RefreshCw,
} from 'lucide-react-native';
import { colors, typography } from '../../src/theme';
import { supabase } from '../../src/utils/supabase';
import { useLocalSearchParams, useRouter } from 'expo-router';

type HackathonStatus = 'Registered' | 'Planning' | 'Building' | 'Submitted';

interface Hackathon {
  id: string;
  name: string;
  platform: string | null;
  deadline: string;
  status: HackathonStatus | null;
  theme: string | null;
  team_size: number | null;
  website_url: string | null;
  submission_link: string | null;
  user_id: string | null;
  prize: string | null;
  location: string | null;
  mode: string | null;
  tags: string[] | null;
  ai_recommendations: string[] | null;  // AI-generated project ideas stored in DB
}

interface Task {
  id: string;
  title: string;
  status: string | null;
  due_date: string | null;
}

interface ChecklistItem {
  id: string;
  title: string;
  is_completed: boolean | null;
}

interface Milestone {
  id: string;
  title: string;
  due_date: string | null;
}

const STATUS_ORDER: HackathonStatus[] = ['Registered', 'Planning', 'Building', 'Submitted'];

const STATUS_COLORS: Record<HackathonStatus, string> = {
  Registered: colors.accentBlue,
  Planning: '#A78BFA',
  Building: colors.accentYellow,
  Submitted: '#4ADE80',
};

function getDaysUntil(dateStr: string): string {
  const diff = Math.ceil(
    (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return 'Today!';
  return `${diff}d left`;
}

export default function HackathonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [hackathon, setHackathon] = useState<Hackathon | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPlanTriggeredAt, setAiPlanTriggeredAt] = useState<string | null>(null);

  // Inline add states
  const [newTask, setNewTask] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [newMilestone, setNewMilestone] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [addingCheck, setAddingCheck] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ name: '', theme: '', website_url: '', submission_link: '' });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    const [hackRes, taskRes, checkRes, mileRes, userRes] = await Promise.all([
      supabase.from('hackathons').select('*').eq('id', id).single(),
      supabase.from('tasks').select('*').eq('hackathon_id', id).order('created_at'),
      supabase.from('checklist_items').select('*').eq('hackathon_id', id).order('created_at'),
      supabase.from('milestones').select('*').eq('hackathon_id', id).order('due_date'),
      supabase.auth.getUser(),
    ]);
    if (hackRes.data) {
      setHackathon(hackRes.data as Hackathon);
      setEditData({
        name: hackRes.data.name || '',
        theme: hackRes.data.theme || '',
        website_url: hackRes.data.website_url || '',
        submission_link: hackRes.data.submission_link || ''
      });
    }
    if (taskRes.data) setTasks(taskRes.data as Task[]);
    if (checkRes.data) setChecklist(checkRes.data as ChecklistItem[]);
    if (mileRes.data) setMilestones(mileRes.data as Milestone[]);
    if (userRes.data?.user) setCurrentUserId(userRes.data.user.id);
    
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // After initial load, show aiGenerating only if no tasks exist yet
  useEffect(() => {
    if (!loading) {
      setAiGenerating(tasks.length === 0 && !hackathon?.ai_recommendations?.length);
    }
  }, [loading, tasks.length, hackathon?.ai_recommendations?.length]);

  // POLLING: while aiGenerating, re-fetch every 5s until NEW data arrives
  useEffect(() => {
    if (!aiGenerating || !id) return;

    const triggeredAt = aiPlanTriggeredAt; // capture snapshot

    const interval = setInterval(async () => {
      const [taskRes, hackRes] = await Promise.all([
        // For re-runs: only look for tasks created AFTER the trigger time
        triggeredAt
          ? supabase.from('tasks').select('id').eq('hackathon_id', id).gt('created_at', triggeredAt).limit(1)
          : supabase.from('tasks').select('id').eq('hackathon_id', id).limit(1),
        supabase.from('hackathons').select('ai_recommendations').eq('id', id).single(),
      ]);
      const hasNewTasks = (taskRes.data?.length ?? 0) > 0;
      // ai_recommendations must be non-null AND non-empty (we cleared it to null on re-run)
      const ideas = hackRes.data?.ai_recommendations;
      const hasIdeas = Array.isArray(ideas) && ideas.length > 0;

      if (hasNewTasks || hasIdeas) {
        fetchAll();
        setAiGenerating(false);
        clearInterval(interval);
      }
    }, 5000);

    const timeout = setTimeout(() => {
      setAiGenerating(false);
      clearInterval(interval);
    }, 120_000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [aiGenerating, id, fetchAll, aiPlanTriggeredAt]);

  // Realtime subscription — also catches live changes (bonus, may not fire in all setups)
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`hackathon_detail_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `hackathon_id=eq.${id}` }, () => {
        setAiGenerating(false);
        fetchAll();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checklist_items', filter: `hackathon_id=eq.${id}` }, () => { fetchAll(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'milestones', filter: `hackathon_id=eq.${id}` }, () => { fetchAll(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hackathons', filter: `id=eq.${id}` }, () => { fetchAll(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchAll]);

  // Toggle checklist item
  const toggleChecklist = async (item: ChecklistItem) => {
    const updated = !item.is_completed;
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, is_completed: updated } : c))
    );
    await supabase.from('checklist_items').update({ is_completed: updated }).eq('id', item.id);
  };

  // Toggle task done/not-done
  const toggleTask = async (task: Task) => {
    const newStatus = task.status === 'done' ? null : 'done';
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t))
    );
    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id);
  };

  // Advance hackathon status
  const advanceStatus = async () => {
    if (!hackathon?.status) return;
    const idx = STATUS_ORDER.indexOf(hackathon.status);
    if (idx >= STATUS_ORDER.length - 1) return;
    const nextStatus = STATUS_ORDER[idx + 1];
    setHackathon((prev) => prev ? { ...prev, status: nextStatus } : prev);
    await supabase.from('hackathons').update({ status: nextStatus }).eq('id', hackathon.id);
  };

  // Add a task
  const addTask = async () => {
    if (!newTask.trim() || !hackathon) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('tasks')
      .insert({ hackathon_id: hackathon.id, user_id: user.id, title: newTask.trim() })
      .select()
      .single();
    if (data) setTasks((prev) => [...prev, data as Task]);
    setNewTask('');
    setAddingTask(false);
  };

  // Add checklist item
  const addChecklist = async () => {
    if (!newCheck.trim() || !hackathon) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('checklist_items')
      .insert({ hackathon_id: hackathon.id, user_id: user.id, title: newCheck.trim() })
      .select()
      .single();
    if (data) setChecklist((prev) => [...prev, data as ChecklistItem]);
    setNewCheck('');
    setAddingCheck(false);
  };

  // Add milestone
  const addMilestone = async () => {
    if (!newMilestone.trim() || !hackathon) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('milestones')
      .insert({ hackathon_id: hackathon.id, user_id: user.id, title: newMilestone.trim() })
      .select()
      .single();
    if (data) setMilestones((prev) => [...prev, data as Milestone]);
    setNewMilestone('');
    setAddingMilestone(false);
  };

  // Delete task
  const deleteTask = (task: Task) => {
    Alert.alert('Delete Task', `Remove "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setTasks((prev) => prev.filter((t) => t.id !== task.id));
          await supabase.from('tasks').delete().eq('id', task.id);
        },
      },
    ]);
  };

  const saveEdits = async () => {
    if (!hackathon) return;
    const { error } = await supabase.from('hackathons').update({
      name: editData.name,
      theme: editData.theme,
      website_url: editData.website_url,
      submission_link: editData.submission_link
    }).eq('id', hackathon.id);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setHackathon({ ...hackathon, ...editData });
      setIsEditing(false);
    }
  };

  const deleteHackathon = () => {
    Alert.alert('Delete Hackathon', `Are you sure you want to remove "${hackathon?.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!hackathon) return;
          await supabase.from('hackathons').delete().eq('id', hackathon.id);
          router.replace('/(tabs)/hackathons');
        },
      },
    ]);
  };

  const regenerateAiPlan = async () => {
    if (!hackathon || !currentUserId) return;

    // Record exactly when we triggered so the poll ignores pre-existing tasks
    const triggeredAt = new Date().toISOString();
    setAiPlanTriggeredAt(triggeredAt);

    // Clear local recommendations immediately so UI shows "Generating…"
    setHackathon(prev => prev ? { ...prev, ai_recommendations: [] } : prev);
    setAiGenerating(true);

    const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3002';
    fetch(`${BACKEND_URL}/api/ai-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hackathon_id: hackathon.id,
        user_id: currentUserId,
        data: hackathon,
      }),
    }).catch(err => {
      console.error('AI plan trigger failed:', err);
      setAiGenerating(false);
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!hackathon) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={24} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={[styles.sectionLabel, { paddingHorizontal: 24, marginTop: 40 }]}>
          Hackathon not found.
        </Text>
      </SafeAreaView>
    );
  }

  const accentColor =
    hackathon.status ? STATUS_COLORS[hackathon.status] : colors.accentBlue;
  const currentStatusIdx = hackathon.status ? STATUS_ORDER.indexOf(hackathon.status) : -1;
  const isSubmitted = hackathon.status === 'Submitted';

  const completedChecklist = checklist.filter((c) => c.is_completed).length;
  const completedTasks = tasks.filter((t) => t.status === 'done').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
            <ArrowLeft color={colors.text} size={24} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'transparent' }}>
            {hackathon.user_id === currentUserId && (
              <>
                <TouchableOpacity onPress={() => setIsEditing(true)}>
                  <Edit2 color={colors.textMuted} size={20} strokeWidth={1.5} />
                </TouchableOpacity>
                <TouchableOpacity onPress={deleteHackathon}>
                  <Trash2 color={colors.textMuted} size={20} strokeWidth={1.5} />
                </TouchableOpacity>
              </>
            )}
            <Text style={styles.logo}>.hack</Text>
          </View>
        </View>

        {/* Hero */}
        <View style={styles.heroSection}>
          {hackathon.platform && (
            <Text style={[styles.heroOrganizer, { color: accentColor }]}>
              {hackathon.platform}
            </Text>
          )}
          <Text style={styles.heroTitle}>{hackathon.name}</Text>

          {/* Deadline pill */}
          <View style={styles.deadlineRow}>
            <View style={[styles.deadlinePill, { borderColor: accentColor }]}>
              <Flag color={accentColor} size={14} strokeWidth={1.5} />
              <Text style={[styles.deadlineText, { color: accentColor }]}>
                {getDaysUntil(hackathon.deadline)}
              </Text>
            </View>
            {hackathon.team_size && (
              <Text style={styles.teamSize}>Team · {hackathon.team_size}</Text>
            )}
          </View>

          {/* Extracted Extras */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, backgroundColor: 'transparent' }}>
            {hackathon.mode && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.text }}>{hackathon.mode === 'online' ? '🌍 Online' : '🏢 ' + hackathon.mode}</Text>
              </View>
            )}
            {hackathon.prize && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.text }} numberOfLines={1}>🏆 {hackathon.prize}</Text>
              </View>
            )}
            {hackathon.location && hackathon.mode !== 'online' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, maxWidth: 200 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.text }} numberOfLines={1}>📍 {hackathon.location}</Text>
              </View>
            )}
            {hackathon.theme && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, maxWidth: 250 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter-Medium', color: colors.text }} numberOfLines={1}>💡 {hackathon.theme}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Status Pipeline */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>STATUS</Text>
          <View style={styles.pipelineRow}>
            {STATUS_ORDER.map((s, i) => {
              const isActive = i === currentStatusIdx;
              const isDone = i < currentStatusIdx;
              return (
                <React.Fragment key={s}>
                  <View style={styles.pipelineStep}>
                    <View
                      style={[
                        styles.pipelineDot,
                        isDone && { backgroundColor: STATUS_COLORS[s] },
                        isActive && { backgroundColor: STATUS_COLORS[s], transform: [{ scale: 1.3 }] },
                      ]}
                    />
                    <Text
                      style={[
                        styles.pipelineLabel,
                        isActive && { color: STATUS_COLORS[s] },
                        isDone && { color: colors.textMuted },
                      ]}
                    >
                      {s}
                    </Text>
                  </View>
                  {i < STATUS_ORDER.length - 1 && (
                    <View style={[styles.pipelineLine, isDone && { backgroundColor: colors.textMuted }]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>
          {!isSubmitted && (
            <TouchableOpacity style={styles.advanceBtn} onPress={advanceStatus} activeOpacity={0.7}>
              <Text style={[styles.advanceBtnText, { color: accentColor }]}>
                Mark as {STATUS_ORDER[currentStatusIdx + 1]} →
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Progress Rings */}
        <View style={styles.progressRow}>
          <View style={styles.progressCard}>
            <Text style={styles.progressNumber}>
              {completedTasks}/{tasks.length}
            </Text>
            <Text style={styles.progressLabel}>Tasks done</Text>
          </View>
          <View style={styles.progressCard}>
            <Text style={styles.progressNumber}>
              {completedChecklist}/{checklist.length}
            </Text>
            <Text style={styles.progressLabel}>Deliverables</Text>
          </View>
          {milestones.length > 0 && (
            <View style={styles.progressCard}>
              <Text style={styles.progressNumber}>{milestones.length}</Text>
              <Text style={styles.progressLabel}>Milestones</Text>
            </View>
          )}
        </View>

        {/* Links */}
        {(hackathon.website_url || hackathon.submission_link) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>LINKS</Text>
            {hackathon.website_url && (
              <View style={styles.linkRow}>
                <ExternalLink color={colors.textMuted} size={16} strokeWidth={1.5} />
                <Text style={styles.linkText} numberOfLines={1}>
                  {hackathon.website_url}
                </Text>
              </View>
            )}
            {hackathon.submission_link && (
              <View style={styles.linkRow}>
                <ExternalLink color={accentColor} size={16} strokeWidth={1.5} />
                <Text style={[styles.linkText, { color: accentColor }]} numberOfLines={1}>
                  {hackathon.submission_link}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Tasks */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>TASKS</Text>
            <TouchableOpacity onPress={() => setAddingTask(true)}>
              <Plus color={colors.textMuted} size={20} strokeWidth={1.5} />
            </TouchableOpacity>
          </View>

          {tasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.itemRow}
              onPress={() => toggleTask(task)}
              onLongPress={() => deleteTask(task)}
              activeOpacity={0.7}
            >
              {task.status === 'done' ? (
                <CheckCircle color={colors.accentYellow} size={22} strokeWidth={1.5} />
              ) : (
                <Circle color={colors.textMuted} size={22} strokeWidth={1.5} />
              )}
              <Text
                style={[
                  styles.itemText,
                  task.status === 'done' && styles.itemTextDone,
                ]}
              >
                {task.title}
              </Text>
              <Trash2
                color="#333"
                size={16}
                strokeWidth={1.5}
                onPress={() => deleteTask(task)}
              />
            </TouchableOpacity>
          ))}

          {addingTask && (
            <View style={styles.addRow}>
              <TextInput
                style={styles.inlineInput}
                placeholder="New task…"
                placeholderTextColor={colors.textMuted}
                value={newTask}
                onChangeText={setNewTask}
                onSubmitEditing={addTask}
                autoFocus
                returnKeyType="done"
              />
              <TouchableOpacity onPress={addTask}>
                <ChevronRight color={colors.accentYellow} size={22} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          )}

          {tasks.length === 0 && !addingTask && (
            <Text style={styles.emptyText}>No tasks yet. Tap + to add one.</Text>
          )}
        </View>

        {/* Deliverables Checklist */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>DELIVERABLES</Text>
            <TouchableOpacity onPress={() => setAddingCheck(true)}>
              <Plus color={colors.textMuted} size={20} strokeWidth={1.5} />
            </TouchableOpacity>
          </View>

          {checklist.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.itemRow}
              onPress={() => toggleChecklist(item)}
              activeOpacity={0.7}
            >
              {item.is_completed ? (
                <CheckCircle color={colors.accentBlue} size={22} strokeWidth={1.5} />
              ) : (
                <Circle color={colors.textMuted} size={22} strokeWidth={1.5} />
              )}
              <Text
                style={[
                  styles.itemText,
                  item.is_completed && styles.itemTextDone,
                ]}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
          ))}

          {addingCheck && (
            <View style={styles.addRow}>
              <TextInput
                style={styles.inlineInput}
                placeholder="New deliverable…"
                placeholderTextColor={colors.textMuted}
                value={newCheck}
                onChangeText={setNewCheck}
                onSubmitEditing={addChecklist}
                autoFocus
                returnKeyType="done"
              />
              <TouchableOpacity onPress={addChecklist}>
                <ChevronRight color={colors.accentBlue} size={22} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          )}

          {checklist.length === 0 && !addingCheck && (
            <Text style={styles.emptyText}>No deliverables yet. Tap + to add one.</Text>
          )}
        </View>

        {/* Milestones */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>MILESTONES</Text>
            <TouchableOpacity onPress={() => setAddingMilestone(true)}>
              <Plus color={colors.textMuted} size={20} strokeWidth={1.5} />
            </TouchableOpacity>
          </View>

          {milestones.map((m) => (
            <View key={m.id} style={styles.milestoneRow}>
              <View style={[styles.milestoneDot, { backgroundColor: accentColor }]} />
              <View style={styles.milestoneContent}>
                <Text style={styles.milestoneTitle}>{m.title}</Text>
                {m.due_date && (
                  <Text style={styles.milestoneDate}>{m.due_date}</Text>
                )}
              </View>
            </View>
          ))}

          {addingMilestone && (
            <View style={styles.addRow}>
              <TextInput
                style={styles.inlineInput}
                placeholder="Milestone title…"
                placeholderTextColor={colors.textMuted}
                value={newMilestone}
                onChangeText={setNewMilestone}
                onSubmitEditing={addMilestone}
                autoFocus
                returnKeyType="done"
              />
              <TouchableOpacity onPress={addMilestone}>
                <ChevronRight color={accentColor} size={22} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          )}

          {milestones.length === 0 && !addingMilestone && (
            <Text style={styles.emptyText}>No milestones yet. Tap + to add one.</Text>
          )}
        </View>

        {/* AI Recommendations */}
        <View style={styles.aiSection}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' }}>
              <Text style={styles.aiSectionLabel}>✨ AI RECOMMENDATIONS</Text>
            </View>
            <TouchableOpacity onPress={regenerateAiPlan} disabled={aiGenerating}>
              <RefreshCw color={aiGenerating ? colors.textMuted : colors.accentYellow} size={16} />
            </TouchableOpacity>
          </View>

          {aiGenerating && (
            <View style={styles.aiGeneratingBanner}>
              <ActivityIndicator size="small" color={colors.accentYellow} />
              <Text style={styles.aiGeneratingText}>AI is analysing this hackathon and building your plan…</Text>
            </View>
          )}

          {hackathon.ai_recommendations && hackathon.ai_recommendations.length > 0 ? (
            hackathon.ai_recommendations.map((idea, idx) => (
              <View key={idx} style={styles.aiIdeaCard}>
                <Text style={styles.aiIdeaNumber}>0{idx + 1}</Text>
                <Text style={styles.aiIdeaText}>{idea}</Text>
              </View>
            ))
          ) : !aiGenerating ? (
            <Text style={styles.emptyText}>No AI recommendations yet.</Text>
          ) : null}
        </View>

      </ScrollView>

      {/* Edit Modal */}
      {isEditing && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Hackathon</Text>
              <TouchableOpacity onPress={() => setIsEditing(false)}>
                <X color={colors.text} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Name</Text>
              <TextInput
                style={styles.modalInput}
                value={editData.name}
                onChangeText={(t) => setEditData(prev => ({ ...prev, name: t }))}
                placeholder="Hackathon Name"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.inputLabel}>Theme</Text>
              <TextInput
                style={styles.modalInput}
                value={editData.theme}
                onChangeText={(t) => setEditData(prev => ({ ...prev, theme: t }))}
                placeholder="E.g. AI, Web3, Healthcare..."
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.inputLabel}>Website URL</Text>
              <TextInput
                style={styles.modalInput}
                value={editData.website_url}
                onChangeText={(t) => setEditData(prev => ({ ...prev, website_url: t }))}
                placeholder="https://..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />

              <Text style={styles.inputLabel}>Submission Link</Text>
              <TextInput
                style={styles.modalInput}
                value={editData.submission_link}
                onChangeText={(t) => setEditData(prev => ({ ...prev, submission_link: t }))}
                placeholder="https://..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />

              <TouchableOpacity style={styles.saveBtn} onPress={saveEdits}>
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 80,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 40,
    backgroundColor: 'transparent',
  },
  logo: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },

  // Hero
  heroSection: {
    paddingHorizontal: 24,
    marginBottom: 48,
    backgroundColor: 'transparent',
  },
  heroOrganizer: {
    ...typography.h3,
    fontWeight: '400',
    marginBottom: 8,
    fontSize: 20,
  },
  heroTitle: {
    ...typography.display,
    color: colors.text,
    marginBottom: 24,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'transparent',
  },
  deadlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
  },
  deadlineText: {
    ...typography.body,
    fontWeight: '500',
    fontSize: 14,
  },
  teamSize: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },

  // Status Pipeline
  section: {
    paddingHorizontal: 24,
    marginBottom: 48,
    backgroundColor: 'transparent',
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  pipelineStep: {
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  pipelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  pipelineLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#222',
    marginBottom: 22,
    marginHorizontal: 4,
  },
  pipelineLabel: {
    ...typography.caption,
    color: '#444',
    fontSize: 10,
  },
  advanceBtn: {
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  advanceBtnText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '500',
  },

  // Progress
  progressRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 0,
    marginBottom: 48,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  progressCard: {
    flex: 1,
    paddingVertical: 24,
    borderRightWidth: 1,
    borderColor: '#1A1A1A',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  progressNumber: {
    ...typography.display,
    fontSize: 36,
    color: colors.text,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
  },

  // Links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  linkText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    flex: 1,
  },

  // Task / Checklist items
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  itemText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '300',
  },
  itemTextDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },

  // Add inline
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  inlineInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    fontSize: 17,
    fontWeight: '300',
    paddingVertical: 0,
  },

  emptyText: {
    ...typography.body,
    color: '#333',
    fontSize: 14,
    paddingVertical: 12,
  },

  // Milestones
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  milestoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  milestoneContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  milestoneTitle: {
    ...typography.body,
    color: colors.text,
    fontSize: 17,
    fontWeight: '300',
  },
  milestoneDate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
  },

  // Modal
  modalOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    ...typography.h3,
    fontSize: 20,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 8,
    marginTop: 16,
  },
  modalInput: {
    ...typography.body,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
  },
  saveBtn: {
    backgroundColor: colors.accentYellow,
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  saveBtnText: {
    ...typography.body,
    fontWeight: '500',
    color: '#000',
  },

  // AI Recommendations
  aiSection: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    backgroundColor: 'transparent',
  },
  aiSectionLabel: {
    ...typography.caption,
    color: colors.accentYellow,
    letterSpacing: 2,
    fontFamily: 'Inter-Medium',
  },
  aiGeneratingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 214, 0, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 214, 0, 0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  aiGeneratingText: {
    ...typography.body,
    color: colors.accentYellow,
    fontSize: 14,
    flex: 1,
    fontFamily: 'Inter-Medium',
  },
  aiIdeaCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  aiIdeaNumber: {
    fontFamily: 'Inter-Medium',
    fontSize: 24,
    color: colors.accentYellow,
    opacity: 0.5,
    lineHeight: 28,
  },
  aiIdeaText: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
    flex: 1,
    lineHeight: 22,
  },
});
