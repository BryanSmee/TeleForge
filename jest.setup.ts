// React 19's act() support requires this flag in test environments; jest-expo's
// preset doesn't set it, so @testing-library/react-native's render/renderHook
// would otherwise warn and bail. Set it once for every test file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
