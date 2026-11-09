// An I/O port on a data bus (HDL-8), as a 6502 peripheral: a write (cs_n LOW, rw LOW) loads d
// into q when the strobe (PHI2) falls; a read (cs_n LOW, rw HIGH) drives pins onto d while the
// strobe is HIGH.
module io_port (
  input strobe,
  input cs_n,
  input rw,
  inout [7:0] d,
  input [7:0] pins,
  output reg [7:0] q
);
  assign d = (!cs_n && rw && strobe) ? pins : 8'bz;
  always @(negedge strobe) if (!cs_n && !rw) q <= d;
endmodule
