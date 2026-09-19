/* Exact, bounded macOS process evidence. Never emit the environment. */
#include <errno.h>
#include <ctype.h>
#include <sys/time.h>
#include <sys/sysctl.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void string_json(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end;
  for (const char *p = argv[1]; *p; p++) if (!isdigit((unsigned char)*p)) return 2;
  errno = 0;
  long parsed = strtol(argv[1], &end, 10);
  if (errno || *end || parsed <= 0 || parsed > 2147483647) return 2;
  int pid = (int)parsed;
  struct proc_bsdinfo before = {0}, after = {0};
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before)) != sizeof(before)) return 3;
  struct timeval boot = {0};
  size_t boot_size = sizeof(boot);
  if (sysctlbyname("kern.boottime", &boot, &boot_size, NULL, 0) || boot_size != sizeof(boot)) return 5;
  if (before.pbi_pid != (unsigned int)pid) return 3;
  if (before.pbi_status == SZOMB) {
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after) ||
        after.pbi_status != SZOMB || before.pbi_pid != after.pbi_pid ||
        before.pbi_ppid != after.pbi_ppid || before.pbi_uid != after.pbi_uid ||
        before.pbi_ruid != after.pbi_ruid || before.pbi_start_tvsec != after.pbi_start_tvsec ||
        before.pbi_start_tvusec != after.pbi_start_tvusec) return 13;
    printf("{\"pid\":%u,\"ppid\":%u,\"uid\":%u,\"realUid\":%u,\"birth\":\"%llu.%06llu\","
           "\"executable\":\"\",\"argv\":[],\"exited\":true,"
           "\"context\":{\"platform\":\"darwin\",\"bootId\":\"%lld.%06d\"}}\n",
           before.pbi_pid, before.pbi_ppid, before.pbi_uid, before.pbi_ruid,
           before.pbi_start_tvsec, before.pbi_start_tvusec, (long long)boot.tv_sec, boot.tv_usec);
    return 0;
  }
  char executable[PROC_PIDPATHINFO_MAXSIZE] = {0};
  if (proc_pidpath(pid, executable, sizeof(executable)) <= 0) return 4;
  int argmax;
  size_t size = sizeof(argmax);
  int limit_mib[] = {CTL_KERN, KERN_ARGMAX};
  if (sysctl(limit_mib, 2, &argmax, &size, NULL, 0)) return 5;
  if (size != sizeof(argmax) || argmax <= 0 || argmax > 4 * 1024 * 1024) return 5;
  char *buf = calloc(1, argmax);
  if (!buf) return 6;
  size = argmax;
  int args_mib[] = {CTL_KERN, KERN_PROCARGS2, pid};
  if (sysctl(args_mib, 3, buf, &size, NULL, 0) || size < sizeof(int) || size > (size_t)argmax) { free(buf); return 7; }
  int nargs;
  memcpy(&nargs, buf, sizeof(nargs));
  if (nargs <= 0 || nargs > 65536) { free(buf); return 8; }
  char *p = buf + sizeof(int), *stop = buf + size;
  while (p < stop && *p) p++;
  while (p < stop && !*p) p++;
  char **args = calloc(nargs, sizeof(char *));
  if (!args) { free(buf); return 9; }
  for (int i = 0; i < nargs; i++) {
    if (p >= stop) { free(args); free(buf); return 10; }
    args[i] = p;
    while (p < stop && *p) p++;
    if (p >= stop) { free(args); free(buf); return 11; }
    p++;
  }
  /* The kernel pads before argv. Reject nonconventional argv[0] and any
     environment-shaped entry rather than risk exposing an ambiguous parse. */
  const char *exe_name = strrchr(executable, '/');
  const char *arg_name = strrchr(args[0], '/');
  exe_name = exe_name ? exe_name + 1 : executable;
  arg_name = arg_name ? arg_name + 1 : args[0];
  if (!*arg_name || strcmp(exe_name, arg_name)) {
    free(args); free(buf); return 14;
  }
  for (int i = 0; i < nargs; i++) {
    const unsigned char *entry = (const unsigned char *)args[i];
    if (isalpha(*entry) || *entry == '_') {
      entry++;
      while (isalnum(*entry) || *entry == '_') entry++;
      if (*entry == '=') { free(args); free(buf); return 14; }
    }
  }
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after)) { free(args); free(buf); return 12; }
  if (before.pbi_pid != (unsigned int)pid || before.pbi_status == SZOMB || after.pbi_status == SZOMB || before.pbi_pid != after.pbi_pid || before.pbi_ppid != after.pbi_ppid ||
      before.pbi_uid != after.pbi_uid || before.pbi_ruid != after.pbi_ruid ||
      before.pbi_start_tvsec != after.pbi_start_tvsec || before.pbi_start_tvusec != after.pbi_start_tvusec) { free(args); free(buf); return 13; }
  printf("{\"pid\":%u,\"ppid\":%u,\"uid\":%u,\"realUid\":%u,\"birth\":\"%llu.%06llu\",\"executable\":",
    before.pbi_pid, before.pbi_ppid, before.pbi_uid, before.pbi_ruid,
    before.pbi_start_tvsec, before.pbi_start_tvusec);
  string_json(executable);
  printf(",\"argv\":[");
  for (int i = 0; i < nargs; i++) { if (i) putchar(','); string_json(args[i]); }
  printf("],\"context\":{\"platform\":\"darwin\",\"bootId\":\"%lld.%06d\"}}\n", (long long)boot.tv_sec, boot.tv_usec);
  free(args);
  free(buf);
  return 0;
}
