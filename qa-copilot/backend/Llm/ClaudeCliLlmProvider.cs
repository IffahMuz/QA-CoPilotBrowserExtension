using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace QaCopilot.Backend.Llm;

public class LlmException(string message) : Exception(message);

public class ClaudeCliLlmProvider : ILlmProvider
{
    private readonly IConfiguration _cfg;
    private readonly ILogger<ClaudeCliLlmProvider> _log;

    public ClaudeCliLlmProvider(IConfiguration cfg, ILogger<ClaudeCliLlmProvider> log)
    {
        _cfg = cfg;
        _log = log;
    }

    public async Task<BugReportDraft> GenerateAsync(object evidence, CancellationToken ct = default)
    {
        var prompt = PromptTemplate.Build(evidence);

        var claudePath = _cfg["Llm:ClaudeCliPath"] ?? "claude";
        var psi = new ProcessStartInfo
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        // On Windows, .cmd wrappers must be invoked through cmd.exe.
        if (OperatingSystem.IsWindows())
        {
            psi.FileName = "cmd.exe";
            psi.ArgumentList.Add("/c");
            psi.ArgumentList.Add(claudePath);
        }
        else
        {
            psi.FileName = claudePath;
        }
        psi.ArgumentList.Add("-p");
        psi.ArgumentList.Add("--output-format");
        psi.ArgumentList.Add("text");

        var sw = Stopwatch.StartNew();
        using var proc = Process.Start(psi)!;
        await proc.StandardInput.WriteAsync(prompt);
        proc.StandardInput.Close();
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        sw.Stop();

        _log.LogInformation("Claude CLI generate: {ms} ms, exit={code}, prompt_chars={n}",
            sw.ElapsedMilliseconds, proc.ExitCode, prompt.Length);

        if (proc.ExitCode != 0)
            throw new LlmException(await proc.StandardError.ReadToEndAsync(ct));

        var json = ExtractFirstObject(stdout);
        return JsonSerializer.Deserialize<BugReportDraft>(json,
                   new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
               ?? throw new LlmException("Empty draft");
    }

    private static string ExtractFirstObject(string text)
    {
        var m = Regex.Match(text, @"\{[\s\S]*\}");
        if (!m.Success) throw new LlmException("No JSON object in CLI output");
        return m.Value;
    }
}
