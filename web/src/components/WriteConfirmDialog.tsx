import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
} from '@mui/material';

/**
 * 写操作二次确认弹窗（增量迭代：主理人决策 #1）。
 * 列明写操作条数与当前连接名；「本次不再提示」勾选后由调用方写入 localStorage。
 */
interface WriteConfirmDialogProps {
  open: boolean;
  writeCount: number;
  connectionName: string;
  onConfirm: () => void;
  onCancel: () => void;
  onDontAskAgain: (checked: boolean) => void;
}

export default function WriteConfirmDialog({
  open,
  writeCount,
  connectionName,
  onConfirm,
  onCancel,
  onDontAskAgain,
}: WriteConfirmDialogProps): JSX.Element {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>确认执行写操作？</DialogTitle>
      <DialogContent>
        <DialogContentText>
          即将对连接 <b>{connectionName}</b> 执行 <b>{writeCount}</b> 条写操作（INSERT / UPDATE /
          DELETE / DDL 等）。该操作会真实修改数据库，请确认无误后再执行。
        </DialogContentText>
        <FormControlLabel
          control={<Checkbox onChange={(e) => onDontAskAgain(e.target.checked)} />}
          label="本次不再提示"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>取消</Button>
        <Button onClick={onConfirm} variant="contained" color="warning">
          确认执行
        </Button>
      </DialogActions>
    </Dialog>
  );
}
