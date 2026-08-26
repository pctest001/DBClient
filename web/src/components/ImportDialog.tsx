import { useRef, useState, type ChangeEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormControl,
  FormLabel,
  Alert,
  Typography,
  CircularProgress,
  Box,
} from '@mui/material';
import { api } from '../api/client';
import type { ConnectionImportItem, ConnectionImportResult, ImportConflictStrategy } from '../types';

/**
 * 导入连接对话框（P2-5 / P1-3）：选 JSON 文件 + 冲突策略 + 展示导入摘要。
 */
export default function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ConnectionImportItem[] | null>(null);
  const [onConflict, setOnConflict] = useState<ImportConflictStrategy>('skip');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConnectionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setItems(null);
    setResult(null);
    setError(null);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { connections?: ConnectionImportItem[] };
      if (!parsed.connections || !Array.isArray(parsed.connections) || parsed.connections.length === 0) {
        throw new Error('文件格式不正确：缺少 connections 数组');
      }
      setFileName(file.name);
      setItems(parsed.connections);
    } catch (err) {
      setError(`读取文件失败：${(err as Error).message}`);
      setFileName(null);
      setItems(null);
    }
  };

  const handleImport = async () => {
    if (!items) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.importConnections({ connections: items, onConflict });
      setResult(res);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>导入连接</DialogTitle>
      <DialogContent>
        <Box className="mb-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          <Button variant="outlined" onClick={() => fileRef.current?.click()}>
            选择 .json 文件
          </Button>
          {fileName && (
            <Typography variant="body2" className="mt-1 text-gray-600">
              已选：{fileName}
              {items ? `（${items.length} 条）` : ''}
            </Typography>
          )}
        </Box>

        <FormControl component="fieldset" className="mb-2">
          <FormLabel component="legend" sx={{ fontSize: 13 }}>
            同名冲突策略
          </FormLabel>
          <RadioGroup
            value={onConflict}
            onChange={(e) => setOnConflict(e.target.value as ImportConflictStrategy)}
          >
            <FormControlLabel value="skip" control={<Radio size="small" />} label="跳过已存在" />
            <FormControlLabel value="overwrite" control={<Radio size="small" />} label="覆盖已存在" />
            <FormControlLabel value="rename" control={<Radio size="small" />} label="重命名（自动加后缀）" />
          </RadioGroup>
        </FormControl>

        {error && (
          <Alert severity="error" className="mt-2">
            {error}
          </Alert>
        )}

        {result && (
          <Alert
            severity={result.errors.length > 0 ? 'warning' : 'success'}
            className="mt-2"
          >
            导入 {result.imported} · 跳过 {result.skipped} · 覆盖 {result.overwritten} · 重命名{' '}
            {result.renamed}
            {result.errors.length > 0 && (
              <Box component="ul" className="mt-1 mb-0 pl-4">
                {result.errors.map((er, i) => (
                  <li key={i}>
                    {er.name}：{er.error}
                  </li>
                ))}
              </Box>
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>关闭</Button>
        <Button
          variant="contained"
          disabled={!items || loading}
          onClick={handleImport}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          导入
        </Button>
      </DialogActions>
    </Dialog>
  );
}
