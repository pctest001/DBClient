import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  TextField,
  MenuItem,
  Stack,
  CircularProgress,
  Snackbar,
  Alert,
} from '@mui/material';
import { api } from '../api/client';
import type { ConnectionInput, ConnectionPublic, DbType } from '../types';

interface Props {
  open: boolean;
  /** 传入则为编辑模式（不含密码，密码留空表示不修改）。 */
  editing: ConnectionPublic | null;
  onClose: () => void;
  onSaved: (conn: ConnectionPublic) => void;
}

const DEFAULT: ConnectionInput = {
  name: '',
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  database: '',
  username: '',
  password: '',
};

/**
 * 新建 / 编辑连接表单（含「测试连接」按钮）。
 * 编辑模式下密码留空表示沿用原密码（服务端以密文比对，前端不感知）。
 */
export default function ConnectionForm({
  open,
  editing,
  onClose,
  onSaved,
}: Props): JSX.Element {
  const [form, setForm] = useState<ConnectionInput>(DEFAULT);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          name: editing.name,
          type: editing.type,
          host: editing.host,
          port: editing.port,
          database: editing.database,
          username: editing.username,
          password: '',
        });
      } else {
        setForm(DEFAULT);
      }
    }
  }, [open, editing]);

  const setField = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.testConnection(form);
      setSnack({ ok: res.ok, msg: res.ok ? `连接成功（${res.latencyMs}ms）` : res.message });
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = editing
        ? await api.updateConnection(editing.id, form)
        : await api.createConnection(form);
      setSnack({ ok: true, msg: '已保存' });
      onSaved(saved);
    } catch (err) {
      setSnack({ ok: false, msg: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? '编辑连接' : '新建连接'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="mt-2">
          <TextField
            label="连接名称"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            select
            label="数据库类型"
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as DbType;
              setField('type', type);
              setField('port', type === 'mysql' ? 3306 : 5432);
            }}
            fullWidth
            size="small"
          >
            <MenuItem value="mysql">MySQL</MenuItem>
            <MenuItem value="postgres">PostgreSQL</MenuItem>
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField
              label="主机"
              value={form.host}
              onChange={(e) => setField('host', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="端口"
              type="number"
              value={form.port}
              onChange={(e) => setField('port', Number(e.target.value))}
              sx={{ width: 120 }}
              size="small"
            />
          </Stack>
          <TextField
            label="数据库名"
            value={form.database}
            onChange={(e) => setField('database', e.target.value)}
            fullWidth
            size="small"
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="用户名"
              value={form.username}
              onChange={(e) => setField('username', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={editing ? '密码（留空则不修改）' : '密码'}
              type="password"
              value={form.password}
              onChange={(e) => setField('password', e.target.value)}
              fullWidth
              size="small"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions className="px-4 pb-4">
        <Button onClick={handleTest} disabled={testing} startIcon={testing ? <CircularProgress size={16} /> : null}>
          测试连接
        </Button>
        <Box className="flex-1" />
        <Button onClick={onClose}>取消</Button>
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
