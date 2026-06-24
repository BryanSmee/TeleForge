import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SetTempModal, type SetTempTarget } from '../SetTempModal';

const target: SetTempTarget = { label: 'Bed', current: 60, presets: [50, 60], max: 120 };

describe('SetTempModal', () => {
  it('renders nothing without a target', async () => {
    await render(<SetTempModal target={null} onSet={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('shows the title, current target and presets', async () => {
    await render(<SetTempModal target={target} onSet={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Set Bed')).toBeOnTheScreen();
    expect(screen.getByText('Current target: 60°C')).toBeOnTheScreen();
    expect(screen.getByText('Off')).toBeOnTheScreen();
    expect(screen.getByText('60°')).toBeOnTheScreen();
  });

  it('calls onSet(0) for Off and the value for a preset', async () => {
    const onSet = jest.fn();
    await render(<SetTempModal target={target} onSet={onSet} onClose={jest.fn()} />);

    fireEvent.press(screen.getByText('Off'));
    expect(onSet).toHaveBeenCalledWith(0);

    fireEvent.press(screen.getByText('50°'));
    expect(onSet).toHaveBeenCalledWith(50);
  });
});
