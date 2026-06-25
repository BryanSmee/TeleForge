import { describe, it, expect, jest } from '@jest/globals';
import type { ComponentProps } from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { MotionControls } from '../MotionControls';
import type { Translator } from '../../i18n/useTranslation';

type Element = Parameters<typeof fireEvent.press>[0];

// Echo the key back so assertions read against the key (e.g. 'motion.home').
const t = ((key: string) => key) as Translator['t'];

const oneExtruder = [{ index: 0, label: 'Nozzle' }];

// fireEvent.press toggles Pressable's internal pressed-state — an async React
// update. Wrap presses in act() so each settles within the test; otherwise the
// pending acts overlap the next async render() and it never commits.
const press = (el: Element) => act(() => void fireEvent.press(el));

// RNTL 14's render is async and must be awaited.
async function renderControls(props: Partial<ComponentProps<typeof MotionControls>> = {}) {
  const onHome = jest.fn();
  const onMove = jest.fn();
  const onExtrude = jest.fn();
  const view = await render(
    <MotionControls
      t={t}
      canMove
      canHome
      extruders={oneExtruder}
      onHome={onHome}
      onMove={onMove}
      onExtrude={onExtrude}
      {...props}
    />,
  );
  return { onHome, onMove, onExtrude, ...view };
}

describe('MotionControls', () => {
  it('renders nothing when the printer can neither move nor home', async () => {
    const { queryByText } = await renderControls({ canMove: false, canHome: false });
    expect(queryByText('motion.title')).toBeNull();
  });

  it('fires onHome', async () => {
    const { onHome, getByText } = await renderControls();
    await press(getByText('motion.home'));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('jogs the X axis by the default step (10mm), signed by direction', async () => {
    const { onMove, getAllByText } = await renderControls();
    // Three axes share the same button labels; the first is X.
    await press(getAllByText('+ 10')[0]);
    expect(onMove).toHaveBeenLastCalledWith('X', 10);
    await press(getAllByText('− 10')[0]);
    expect(onMove).toHaveBeenLastCalledWith('X', -10);
  });

  it('applies a newly-selected step to the next jog', async () => {
    const { onMove, getByText, getAllByText } = await renderControls();
    await press(getByText('0.1')); // unique to the step row
    await press(getAllByText('+ 0.1')[0]);
    expect(onMove).toHaveBeenLastCalledWith('X', 0.1);
  });

  it('extrudes/retracts the default amount (5mm) on the default tool', async () => {
    const { onExtrude, getByText } = await renderControls();
    await press(getByText('motion.extrude'));
    expect(onExtrude).toHaveBeenLastCalledWith(0, 5);
    await press(getByText('motion.retract'));
    expect(onExtrude).toHaveBeenLastCalledWith(0, -5);
  });

  it('extrudes on the selected tool when there are multiple', async () => {
    const { onExtrude, getByText } = await renderControls({
      extruders: [
        { index: 0, label: 'N1' },
        { index: 1, label: 'N2' },
      ],
    });
    await press(getByText('N2'));
    await press(getByText('motion.extrude'));
    expect(onExtrude).toHaveBeenLastCalledWith(1, 5);
  });

  it('does not fire actions while disabled (printing)', async () => {
    const { onHome, onExtrude, getByText } = await renderControls({ disabled: true });
    await press(getByText('motion.home'));
    await press(getByText('motion.extrude'));
    expect(onHome).not.toHaveBeenCalled();
    expect(onExtrude).not.toHaveBeenCalled();
  });
});
