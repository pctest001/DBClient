import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Stack,
  CircularProgress,
  Snackbar,
  Alert,
  Typography,
} from '@mui/material';
import { useAppStore } from '../store/appStore';

/**
 * AI 接口配置弹窗（P1-3）：base URL / API Key / 模型 + 启用开关 + 连通性测试。
 * 已配置密钥时 API Key 字段留空表示保持不变（后端保留原密文）。
 */
export default function SettingsDialog(): JSX.Element {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const loadAiSettings = useAppStore((s) => s.loadAiSettings);
  const saveAiSettings = useAppStore((s) => s.saveAiSettings);
  const testAiSettings = useAppStore((s) => s.testAiSettings);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      setSnack(null);
      void loadAiSettings().then((s) => {
        if (s) {
          setBaseUrl(s.baseUrl);
          setModel(s.model);
          setEnabled(s.enabled);
          setHasKey(s.hasKey);
          setApiKey(''); // 不回显密钥
        }
      });
    }
  }, [open, loadAiSettings]);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await testAiSettings({ baseUrl, apiKey, model, enabled });
      setSnack({ ok: res.ok, msg: res.message });
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveAiSettings({ baseUrl, apiKey, model, enabled });
      setSnack({ ok: true, msg: '已保存' });
      setHasKey(true);
      setApiKey('');
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>AI / 接口配置</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="mt-2">
          <TextField
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={hasKey ? 'API Key（留空则保持不变）' : 'API Key'}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="模型名"
            placeholder="gpt-4o / qwen-plus / ollama/llama3"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            fullWidth
            size="small"
          />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="启用 AI 生成（关闭后 AI 面板不可用）"
          />
          <Typography variant="caption" className="text-gray-500">
            兼容 OpenAI Chat Completions 协议；密钥将以密文本地存储。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions className="px-4 pb-4">
        <Button onClick={handleTest} disabled={testing} startIcon={testing ? <CircularProgress size={16} /> : null}>
          测试连通性
        </Button>
        <Box className="flex-1" />
        <Button onClick={() => setOpen(false)}>关闭</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          保存
        </Button>
      </DialogActions>
      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.ok ? 'success' : 'error'} onClose={() => setSnack(null)}>
            {snack.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Dialog>
  );
}
