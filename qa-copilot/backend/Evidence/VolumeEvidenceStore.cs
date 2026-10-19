using System.Text.Json;

namespace QaCopilot.Backend.Evidence;

public class VolumeEvidenceStore : IEvidenceStore
{
    private readonly string _root;

    public VolumeEvidenceStore(IConfiguration cfg) =>
        _root = cfg["Evidence:Root"] ?? "/evidence";

    public async Task<EvidenceManifest> SaveAsync(Guid captureId, IFormFileCollection files)
    {
        var dir = Path.Combine(_root, captureId.ToString());
        Directory.CreateDirectory(dir);
        var manifest = new EvidenceManifest();
        foreach (var f in files.Where(f => !string.IsNullOrWhiteSpace(f.FileName)))
        {
            var path = Path.Combine(dir, f.FileName);
            await using var fs = File.Create(path);
            await f.CopyToAsync(fs);
            manifest.Add(f.Name, path);
        }
        return manifest;
    }

    public async Task WriteJsonAsync(Guid captureId, string fileName, object payload, EvidenceManifest manifest)
    {
        var dir = Path.Combine(_root, captureId.ToString());
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, fileName);
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(payload));
        manifest.Add(Path.GetFileNameWithoutExtension(fileName), path);
    }

    public Task<Stream> OpenAsync(string path) =>
        Task.FromResult<Stream>(File.OpenRead(path));
}
