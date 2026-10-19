using Microsoft.EntityFrameworkCore;
using QaCopilot.Backend.Ado;
using QaCopilot.Backend.Data;
using QaCopilot.Backend.Evidence;
using QaCopilot.Backend.Llm;
using QaCopilot.Backend.Teams;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.SetIsOriginAllowed(_ => true)   // chrome-extension:// origins have dynamic UUIDs
     .AllowAnyMethod()
     .AllowAnyHeader()));
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

builder.Services.AddSingleton<IEvidenceStore, VolumeEvidenceStore>();
builder.Services.AddSingleton<ILlmProvider, ClaudeCliLlmProvider>();
builder.Services.AddHttpClient<IAdoClient, AdoRestClient>();
builder.Services.AddHttpClient<INotifier, TeamsWebhookNotifier>();

var app = builder.Build();

app.UseExceptionHandler(errApp => errApp.Run(async ctx =>
{
    var feature = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
    if (feature is not null)
    {
        var log = ctx.RequestServices.GetRequiredService<ILogger<Program>>();
        log.LogError(feature.Error, "Unhandled exception in {Path}", ctx.Request.Path);
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new {
            error = feature.Error.Message,
            inner = feature.Error.InnerException?.Message,
            inner2 = feature.Error.InnerException?.InnerException?.Message,
        });
    }
}));

app.UseCors();
app.MapControllers();
app.Run();
