using System;
using System.Threading;

internal sealed class PanelInstance : IDisposable
{
    private readonly Mutex mutex;
    internal bool IsOwner { get; private set; }

    internal PanelInstance(string identity)
    {
        mutex = new Mutex(false, @"Local\PoBAI.Panel." + identity);
        // An existing kernel object is not proof of an existing window. WebView2 or
        // an exiting process can retain its handle after the window has closed.
        try { IsOwner = mutex.WaitOne(0); }
        catch (AbandonedMutexException) { IsOwner = true; }
    }

    public void Dispose()
    {
        if (IsOwner) { mutex.ReleaseMutex(); IsOwner = false; }
        mutex.Dispose();
    }
}
