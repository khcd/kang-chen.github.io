# Running Local LLMs on Intel Mac with Dual AMD Radeon W5700X GPUs: A Journey Through llama.cpp and MoltenVK

## Introduction

I had an old Mac Pro 2019 that I was considering selling for a long time, but becasue they sell for next to nothing now I decided to try running it has a local server for LLMs.

This is the story of how I went from complete gibberish output at 70+ tokens/second to working, coherent inference at 13.5 tokens/second on a 32B parameter model.

## Why llama.cpp?

The goal was simple: run large language models locally for Cline in VS Code. The requirements were:

- **Large context windows** (8K-32K tokens) for working with entire codebases
- **30B+ parameter models** for quality code generation
- **Cost-effective** infrastructure using hardware I already owned
- **Reliable** enough for production agent workflows

I only looked at a couple of options:

- **vLLM**: High-performance but designed for CUDA/Linux setups
- **llama.cpp**: Lower-level, maximum control, Vulkan support for AMD GPUs on macOS

I chose llama.cpp because it offered direct Vulkan backend support, which theoretically could leverage my dual W5700X setup on macOS through MoltenVK (the Vulkan-to-Metal translation layer).

## The Intel Mac + AMD GPU Unicorn Problem

Basially discontinued CPU and discontinued GPU = lack of support.

**My setup:**
- Mac Pro 7,1 (last Intel Mac Pro, discontinued 2023)
- 2x AMD Radeon Pro W5700X (16GB VRAM each, RDNA1 architecture)

## Building llama.cpp with Vulkan Support

### Initial Build

The build process itself was straightforward:

```bash
cd ~/Work
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp

# Build with Vulkan backend
cmake -B build \
  -DGGML_VULKAN=ON \
  -DCMAKE_BUILD_TYPE=Release

cmake --build build --config Release
```

### Verifying GPU Detection

The critical first test—did llama.cpp detect both GPUs?

```bash
./build/bin/llama-cli --version

# Output showed:
# Vulkan backend enabled
# Found 2 Vulkan devices:
#   - AMD Radeon Pro W5700X (16384 MB)
#   - AMD Radeon Pro W5700X (16384 MB)
```

Success! Both GPUs were visible to the Vulkan backend.

## Initial Testing

### The First Models

I started with Qwen2.5-Coder-7B-Instruct in Q4_K_M quantization:

```bash
./build/bin/llama-cli \
  -hf bartowski/Qwen2.5-Coder-7B-Instruct-GGUF \
  -m Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf \
  -p "def fibonacci(n):" \
  -n 50 \
  -ngl 99  # Offload all layers to GPU
```

The results weren't good:

```
Prompt: 73.0 t/s | Generation: 71.8 t/s

Output: 动了@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@...
```

**71.8 tokens per second of complete gibberish.** Chinese characters, random symbols, repetition—but blazingly fast.

### CPU Baseline Test

To verify the model itself wasn't corrupted:

```bash
./build/bin/llama-cli \
  -m Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf \
  -p "def fibonacci(n):" \
  -n 50 \
  -ngl 0  # Force CPU only
```

Result: Perfect Python code at 9.6 tokens/second.

**Conclusion:** The model was fine. GPU acceleration was working (speed proved that), but the output was completely corrupted.

## The Hunt for the Bug

### What I Observed

1. **Speed proved GPU was working**: 71.8 tok/s vs 9.6 tok/s CPU-only (7.5x speedup)
2. **Both GPUs showed activity** in Activity Monitor during inference
3. **The corruption was deterministic**: Same gibberish patterns every time
4. **Different models showed the same issue**: Tried DeepSeek-Coder-33B, Qwen variants—all corrupted
5. **Quantization didn't matter**: Q4, Q6, Q8 all showed corruption (though Q8 behaved differently)

### The Investigation

The debug process involved:

```bash
# Checking Vulkan installation
vulkaninfo --summary

# Output:
# Vulkan Instance Version: 1.3.296
# Found 2 devices...

# Checking which MoltenVK version was in use
vulkaninfo | grep -i "driverVersion\|driverName"

# Output:
# driverName: MoltenVK
# driverVersion: 0.2.2019 (10211)  # <- The smoking gun!
```

**MoltenVK version 0.2.2019**—from 2019! I was running a six-year-old translation layer. Maybe something I fiddled around with back in the day?

## The Critical Discovery: MoltenVK Version

### Understanding MoltenVK

MoltenVK is a translation layer that converts Vulkan API calls to Metal API calls on macOS:

```
llama.cpp (Vulkan calls)
    ↓
MoltenVK (translation layer) ← The problem was here
    ↓
Metal API
    ↓
AMD GPU hardware
```

### The Upgrade Process

```bash
# Check what Homebrew has
brew info molten-vk
# Output: stable 1.4.0 (bottled)

# Install the update
brew upgrade molten-vk

# Fix permissions (needed on my system)
sudo chown -R $(whoami):admin /usr/local/include/MoltenVK
sudo chown -R $(whoami):admin /usr/local/lib/libMoltenVK.dylib

# Force link the new version
brew link --overwrite molten-vk

# Verify the upgrade
vulkaninfo | grep -i "driverVersion"
# Output: driverVersion = 0.2.2208 (10400)
```

## Testing again

```bash
./build/bin/llama-cli \
  -hf bartowski/Qwen2.5-Coder-7B-Instruct-GGUF \
  -m Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf \
  -p "def fibonacci(n):" \
  -n 50 \
  -ngl 99
```

Output:

```python
def fibonacci(n):
    if n <= 0:
        return "Input should be a positive integer"
    elif n == 1:
        return 0
    elif n == 2:
        return 1
    ...

[ Prompt: 51.4 t/s | Generation: 43.5 t/s ]
```

**Perfect coherent Python code at 43.5 tokens per second.** The MoltenVK upgrade had fixed it.

## Scaling Up: Testing Larger Models

### Qwen2.5-Coder-32B-Instruct

With the corruption issue resolved, I could finally test the models I actually wanted to use:

```bash
./build/bin/llama-server \
  -m qwen2.5-coder-32b-instruct-q5_k_m.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -c 32768 \  # 32K context window
  -ngl 999 \  # All layers to GPU
  --threads 8 \
  --flash-attn
```

Performance:
- **Prompt processing**: ~15-20 t/s (varies with prompt length)
- **Token generation**: **13.5 t/s** sustained
- **Context window**: 32K tokens working reliably
- **VRAM usage**: ~28GB across both GPUs

This was the sweet spot—large enough for complex code generation, fast enough for interactive use.

## Integration with Cline: The Large Context Challenge

### Setting Up llama.cpp as an OpenAI-Compatible Server

To use the model with Cline in VS Code:

```bash
# Start llama-server
./build/bin/llama-server \
  -m qwen2.5-coder-32b-instruct-q5_k_m.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -c 32768 \
  -ngl 999
```

**Cline configuration:**
- Provider: OpenAI Compatible
- Base URL: `http://localhost:8080/v1`
- API Key: `dummy` (llama.cpp doesn't validate it)
- Model ID: `qwen2.5-coder` (or any string, llama.cpp uses whatever model is loaded)

### The Context Window Error

When trying to use Cline with large codebases:

```json
{
  "message": "400 request (13398 tokens) exceeds the available context size (4096 tokens)",
  "n_prompt_tokens": 13398,
  "n_ctx": 4096
}
```

The issue wasn't the model's capability (Qwen2.5-Coder supports 32K natively), but the server's default context limit. Simply restarting with `-c 32768` resolved it.

### Practical Performance with Cline

Real-world usage patterns:

- **Simple queries** (< 1000 tokens): ~20 t/s, interactive
- **Medium tasks** (1000-5000 tokens): ~15 t/s, usable
- **Large context** (5000-15000 tokens): ~10-13 t/s, slower but functional
- **Huge context** (15000+ tokens): Prompt processing becomes the bottleneck coming down to 5 t/s

## The Prompt Processing Bottleneck: A Technical Deep Dive

### Why Is Prompt Processing Limited to One GPU?

This was perhaps the most interesting technical discovery. Even though token generation happily utilized both GPUs, prompt processing (prefill) stubbornly used only one. The reason is **fundamental to the algorithms involved**.

### Prefill vs. Decode: Different Optimization Characteristics

**Prompt Processing (Prefill):**
- Processes **all input tokens in parallel** in a single large batch
- Computes the KV cache for the entire prompt in one forward pass
- **Memory bandwidth intensive**: Needs to read model weights once and process many tokens
- High data dependency: Attention computations reference each other
- **PCIe transfers would kill performance**: Moving intermediate activations between GPUs for every layer creates massive overhead

**Token Generation (Decode):**
- Processes **one token at a time** sequentially
- Only computes a new KV cache entry for that single token
- **Compute intensive**: Repeatedly loads model weights for each token
- Lower data transfer: Just the new token's hidden states
- **Multi-GPU helps**: Amortizing PCIe costs over many sequential operations

### The Bandwidth Math

On a single W5700X:
- GPU memory bandwidth: **448 GB/s**

Between GPUs via PCIe 3.0 x16:
- Theoretical: **16 GB/s each direction**
- Practical: ~12-14 GB/s with overhead

For prompt processing, syncing intermediate results across GPUs every layer would create a **~30x bandwidth bottleneck** compared to keeping everything on one GPU.

### Why Multi-GPU Still Works for Decode

During token generation, the **repeated model weight access** (generating 100+ tokens sequentially) amortizes the PCIe overhead:

```
Single token generation:
├─ Load layer weights from GPU 0 → process → transfer to GPU 1
├─ Load layer weights from GPU 1 → process → transfer back
└─ Repeat for all layers
```

Over 100 tokens, the overhead becomes acceptable. But for prefill, you'd pay this cost for every position in a potentially 32K token sequence.

### Could This Be Improved?

**Where the logic would need to change:**

The limitation is primarily in **llama.cpp's Vulkan backend**, specifically in how it implements the batched matrix multiplications for attention. To enable multi-GPU prefill would require:

1. **Tensor parallelism** for attention operations
2. **Pipeline parallelism** with careful layer assignment
3. **Sophisticated scheduling** to overlap communication and computation

None of these are currently implemented in llama.cpp's Vulkan backend, though they exist in more specialized frameworks like vLLM or TensorRT-LLM (which target CUDA/Linux).

**MoltenVK's role**: MoltenVK just translates the commands—it can't optimize what llama.cpp doesn't ask it to do. The multi-GPU strategy is decided entirely at the llama.cpp level.

## Model Testing Results

I was sticking to mainly Qwen because a

| Model | Quantization | VRAM | Prompt t/s | Generate t/s | Quality | Notes |
|-------|--------------|------|------------|--------------|---------|-------|
| Qwen2.5-Coder-7B | Q4_K_M | ~5GB | 51.4 | 43.5 | Excellent | Fast, great for quick tasks |
| Qwen2.5-Coder-14B | Q4_K_M | ~9GB | ~35 | ~25 | Excellent | Good middle ground |
| Qwen2.5-Coder-32B | Q5_K_M | ~24GB | 15-20 | **13.5** | Outstanding | **Production choice** |
| DeepSeek-Coder-33B | Q4_K_M | ~20GB | ~18 | 14.7 | Excellent | Alternative to Qwen but does not work at all with Cline due to tool calls? |

**Key finding:** Q8 quantization with full GPU offload caused memory boundary issues and crashes, but Q4/Q5 worked flawlessly.

## Lessons Learned

### 1. Check Your Dependencies (Especially Translation Layers)

MoltenVK being 6 years out of date was a bit of a hidden issue. On macOS with AMD GPUs, **verify your MoltenVK version** before assuming hardware or software bugs.

```bash
# Always run this first
vulkaninfo | grep -i "driverVersion\|driverName"
```

### 3. Fallback to CPU Baseline Testing

The 5-minute CPU test immediately told me:
- The model file was fine
- llama.cpp itself was working
- The problem was specifically in the GPU code path

### 4. Prompt Processing vs. Token Generation Are Different Problems

Understanding that prefill and decode have fundamentally different optimization characteristics explained why:
- Single-GPU prefill makes sense algorithmically
- Multi-GPU decode works well
- "Just add more GPUs" wouldn't help my large context issue

This knowledge helps set realistic expectations for performance tuning.

### 5. Quantization Matters (But Not How I Expected)

Q4 and Q5 quantizations worked perfectly. Q8 hit memory boundary issues and caused corruption with full offload (`-ngl 99`), but worked fine with hybrid offload (`-ngl 50`). The lesson: **more bits isn't always better** if it pushes you past VRAM limits or into unstable memory regions.

## Final Configuration

My production setup for AI-assisted coding:

```bash
#!/bin/bash
# ~/llama-server-start.sh

cd ~/Work/llama.cpp

./build/bin/llama-server \
  -m models/qwen2.5-coder-32b-instruct-q5_k_m.gguf \
  --host 0.0.0.0 \
  --port 8080 \
  -c 32768 \
  -ngl 999 \
  --threads 8 \
  --flash-attn \
  --log-disable
```

**Performance:**
- **Prompt processing**: 15-20 t/s (single GPU, memory bandwidth bound)
- **Token generation**: 13.5 t/s (dual GPU, compute bound)
- **Context window**: 32K tokens
- **VRAM usage**: ~28GB (comfortable on 32GB total)
- **Uptime**: Runs 24/7 reliably

## Conclusion

What started as a straightforward "build llama.cpp with Vulkan" project turned into a deep dive through the GPU computing stack on macOS. The journey taught me:

- How Vulkan-to-Metal translation works (and fails)
- Differences between prompt processing and token generation
- Why multi-GPU setups don't always scale linearly

The final result—13.5 tokens/second on a 32B parameter model with 32K context window, but this is just output speed in reality it falls over in a real life scenario due to large context windows. Say I was trying to analyse a particular file in lamma.cpp it was far closing to 4t/s so many modern CPU's would have been faster?

For anyone attempting similar setups on Intel Macs with AMD GPUs: **check your MoltenVK version first**. That one command might save you hours.

## Technical Specifications

**Hardware:**
- Mac Pro 7,1 (2019)
- 2x AMD Radeon Pro W5700X (16GB VRAM each, RDNA1)
- 96GB system RAM

**Software:**
- macOS Ventura 13.x
- MoltenVK 1.4.0 (upgraded from 0.2.2019)
- llama.cpp (latest, built from source with Vulkan backend)
- Vulkan SDK 1.3.296

**Model:**
- Qwen2.5-Coder-32B-Instruct
- Q5_K_M quantization
- 32K native context window

**Integration:**
- Cline (VS Code extension)
- OpenAI-compatible API endpoint

---

*For questions or discussion about this setup, feel free to reach out. The full command examples and configuration files are available in this post.*