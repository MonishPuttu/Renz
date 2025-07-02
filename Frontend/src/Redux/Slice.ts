import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface PromptState {
  prompt: string;
}

const initialState: PromptState = {
  prompt: ''
};

const promptSlice = createSlice({
  name: 'prompt',
  initialState,
  reducers: {
    setPrompt: (state, action: PayloadAction<string>) => {
      state.prompt = action.payload;
    }
  }
});

export const { setPrompt } = promptSlice.actions;
export default promptSlice.reducer;
